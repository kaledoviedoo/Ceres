"""Carga la finca sintetica La Cuadricula en la base de datos.

DATASET SINTETICO DE PRUEBA DE CERES.

    py scripts/generate_cuadricula.py                     # solo informa
    py scripts/generate_cuadricula.py --apply             # carga
    py scripts/generate_cuadricula.py --apply --reset     # regenera desde cero
    py scripts/generate_cuadricula.py --manifest docs/cuadricula-manifest.json

POR QUE NO GENERA UN .sql COMO `generate_demo_data.py`
------------------------------------------------------
Aquel dataset son 800 celdas y cabe en un archivo que se puede leer. Este son
~210.000 filas: el SQL renderizado pasaria de 100 MB, y construirlo como una
sola cadena en memoria antes de enviarlo no tiene ninguna ventaja. Se insertan
por bloques con SQLAlchemy Core, que ademas parametriza los valores en vez de
interpolarlos en texto.

IDEMPOTENCIA
------------
Todos los ids son UUID v5 derivados de una clave legible, asi que reejecutar
produce exactamente los mismos. Cada insercion lleva `ON CONFLICT (id) DO
NOTHING`: la segunda pasada no duplica nada y no falla.

`predictions` NO admite otra cosa. La migracion 0002 pone un trigger que
prohibe UPDATE y DELETE sobre esa tabla, asi que `DO NOTHING` no es una eleccion
conservadora: es la unica que existe. Es coherente con la regla del proyecto de
que una prediccion nunca se sobrescribe.

CUANDO HACE FALTA `--reset`
---------------------------
Justo porque los ids son estables: si el GENERADOR cambia, la segunda pasada
encuentra los mismos ids con valores distintos y `DO NOTHING` conserva los
viejos, dejando una mezcla silenciosa de dos versiones. `--reset` borra las
filas de esta finca antes de escribir. Sin cambiar el generador no hace falta.

LA FINCA DEMO NO SE TOCA
------------------------
Namespace de UUID propio, prefijos de lote P/M/Z/R y organizacion aparte. Todos
los borrados de `--reset` van filtrados por `farm_id`, con una excepcion que no
se puede evitar: `predictions` solo se vacia con TRUNCATE --la migracion 0002
prohibe DELETE-- y eso no distingue fincas. Por eso `reset()` comprueba antes
que no haya predicciones de otra finca y se planta si las hay.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

import _bootstrap  # noqa: F401  (pone apps/api en sys.path)

from app.core.synthetic.cuadricula import MASTER_SEED, PLOT_ORDER, SCENARIO
from app.core.synthetic.cuadricula_dataset import (
    CuadriculaDataset,
    build_cuadricula_dataset,
    build_manifest,
)

#: Filas por sentencia. 1.000 mantiene el tamano del paquete razonable sobre una
#: conexion remota sin pagar una ida y vuelta por fila.
BATCH_SIZE = 1_000


def batched(rows: Iterable[dict[str, Any]], size: int) -> Iterator[list[dict[str, Any]]]:
    bloque: list[dict[str, Any]] = []
    for row in rows:
        bloque.append(row)
        if len(bloque) >= size:
            yield bloque
            bloque = []
    if bloque:
        yield bloque


def insert_rows(connection, table, rows: Iterable[dict[str, Any]]) -> int:
    """Inserta por bloques, ignorando lo que ya estuviera. Devuelve cuantas filas."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    total = 0
    for bloque in batched(rows, BATCH_SIZE):
        connection.execute(
            pg_insert(table).on_conflict_do_nothing(index_elements=["id"]), bloque
        )
        total += len(bloque)
    return total


def reset(connection, farm_id) -> dict[str, int]:
    """Borra las filas de La Cuadricula para poder regenerarla.

    HACE FALTA, y no es opcional: los ids son UUID v5 derivados de una clave
    legible, asi que regenerar produce LOS MISMOS ids. Con `ON CONFLICT DO
    NOTHING` --que es lo que usa la carga-- una segunda pasada tras cambiar el
    generador dejaria intactos los valores viejos y el dataset seria una mezcla
    silenciosa de dos versiones.

    `predictions` se vacia con TRUNCATE porque la migracion 0002 pone un trigger
    que prohibe DELETE sobre esa tabla, y el borrado en cascada tampoco puede
    saltarselo. TRUNCATE no distingue por finca, asi que antes se comprueba que
    no haya predicciones de otra: si las hay, esto se planta en vez de
    destruirlas.
    """
    from sqlalchemy import text

    ajenas = connection.execute(
        text("""
        SELECT count(*) FROM predictions p
        JOIN grid_cells g ON g.id = p.cell_id
        JOIN plots l ON l.id = g.plot_id
        WHERE l.farm_id <> :farm
        """),
        {"farm": farm_id},
    ).scalar()
    if ajenas:
        raise SystemExit(
            f"ABORTADO: hay {ajenas:,} predicciones de otras fincas y vaciar "
            "`predictions` exige TRUNCATE (trigger de inmutabilidad de la "
            "migracion 0002). No se destruye nada que no sea de esta finca."
        )

    borradas: dict[str, int] = {}
    connection.execute(text("TRUNCATE TABLE predictions"))
    borradas["predictions"] = -1  # TRUNCATE no informa de cuantas
    for tabla, sentencia in (
        ("harvests", "DELETE FROM harvests WHERE cell_id IN (SELECT g.id FROM grid_cells g "
                     "JOIN plots l ON l.id = g.plot_id WHERE l.farm_id = :farm)"),
        ("observations", "DELETE FROM observations WHERE cell_id IN (SELECT g.id FROM grid_cells g "
                         "JOIN plots l ON l.id = g.plot_id WHERE l.farm_id = :farm)"),
        ("grid_cells", "DELETE FROM grid_cells WHERE plot_id IN "
                       "(SELECT id FROM plots WHERE farm_id = :farm)"),
        ("crop_cycles", "DELETE FROM crop_cycles WHERE plot_id IN "
                        "(SELECT id FROM plots WHERE farm_id = :farm)"),
        ("plots", "DELETE FROM plots WHERE farm_id = :farm"),
    ):
        borradas[tabla] = connection.execute(text(sentencia), {"farm": farm_id}).rowcount
    return borradas


def load(dataset: CuadriculaDataset, limpiar: bool = False) -> dict[str, int]:
    """Escribe la finca. Las tablas van en orden de dependencia."""
    from app.db import engine
    from app.models import (
        Crop,
        CropCycle,
        Farm,
        GridCell,
        Harvest,
        Observation,
        Organization,
        Plot,
        Prediction,
    )

    contadores: dict[str, int] = {}

    with engine.begin() as connection:
        if limpiar:
            borradas = reset(connection, dataset.farms[0]["id"])
            print("   limpieza previa: " + ", ".join(
                f"{t}={'todas' if n < 0 else format(n, ',')}" for t, n in borradas.items()
            ))
        contadores["organizations"] = insert_rows(
            connection, Organization.__table__, dataset.organizations
        )
        contadores["farms"] = insert_rows(connection, Farm.__table__, dataset.farms)
        contadores["plots"] = insert_rows(connection, Plot.__table__, dataset.plots)
        contadores["crops"] = insert_rows(connection, Crop.__table__, dataset.crops)
        contadores["crop_cycles"] = insert_rows(
            connection, CropCycle.__table__, dataset.crop_cycles
        )

        # Lote a lote: los iteradores generan sobre la marcha y nunca hay mas de
        # BATCH_SIZE filas vivas a la vez.
        for nombre, tabla, metodo in (
            ("grid_cells", GridCell.__table__, dataset.iter_cells),
            ("observations", Observation.__table__, dataset.iter_observations),
            ("predictions", Prediction.__table__, dataset.iter_predictions),
            ("harvests", Harvest.__table__, dataset.iter_harvests),
        ):
            total = 0
            for code in PLOT_ORDER:
                comienzo = time.time()
                escritas = insert_rows(connection, tabla, metodo(code))
                total += escritas
                print(
                    f"   {nombre:14s} lote {code}: {escritas:>7,} filas "
                    f"({time.time() - comienzo:.1f}s)",
                    flush=True,
                )
            contadores[nombre] = total

    return contadores


def report(dataset: CuadriculaDataset) -> None:
    """Lo que se va a escribir, sin escribirlo."""
    print(f"Finca sintetica: {len(dataset.plots)} lotes, semilla {dataset.seed}")
    for crop in SCENARIO:
        verdad = dataset.truth[crop.code]
        zonas = sum(int(m.sum()) for m, _ in dataset.masks[crop.code].values())
        print(
            f"  {crop.code} {crop.crop_name:10s} "
            f"cosecha {verdad.sum():>10,.1f} kg (objetivo {crop.target_t_per_ha * 1000:>8,.0f}) "
            f"| celda {verdad.min():.2f}-{verdad.max():.2f} sigma {verdad.std():.3f} "
            f"| {zonas:>5,} observaciones"
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Genera y carga la finca sintetica La Cuadricula"
    )
    parser.add_argument("--seed", type=int, default=MASTER_SEED)
    parser.add_argument(
        "--apply", action="store_true", help="Escribir en DATABASE_URL (sin esto solo informa)"
    )
    parser.add_argument(
        "--manifest", type=Path, default=None, help="Ruta donde escribir el manifiesto JSON"
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Borrar las filas de esta finca antes de cargar. Necesario tras "
             "cambiar el generador: los ids son estables y `ON CONFLICT DO "
             "NOTHING` conservaria los valores viejos.",
    )
    args = parser.parse_args()

    comienzo = time.time()
    dataset = build_cuadricula_dataset(seed=args.seed)
    print(f"-> Campo generado en {time.time() - comienzo:.2f}s")
    report(dataset)

    if args.manifest:
        manifiesto = build_manifest(dataset, generated_at=datetime.now(timezone.utc))
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        args.manifest.write_text(
            json.dumps(manifiesto, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        print(f"-> Manifiesto escrito en {args.manifest}")

    if not args.apply:
        print("\n(sin --apply no se ha escrito nada)")
        return 0

    from app.config import get_settings

    # Solo el host. La URL lleva la contrasena y no se imprime nunca.
    host = get_settings().database_url.split("@")[-1].split("?")[0]
    print(f"\n-> Cargando en {host}")
    comienzo = time.time()
    contadores = load(dataset, limpiar=args.reset)
    print(f"\n-> Carga terminada en {time.time() - comienzo:.1f}s")
    for tabla, filas in contadores.items():
        print(f"   {tabla:16s} {filas:>8,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
