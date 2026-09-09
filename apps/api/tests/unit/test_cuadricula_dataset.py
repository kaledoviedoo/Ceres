"""EL DATASET DE LA CUADRICULA: eventos, verdad, predicciones y procedencia.

Lo que se vigila aqui es lo que hace util al dataset: que las zonas de evento
tengan causa espacial, que la cosecha cuadre con el objetivo SIN ser uniforme,
que las predicciones salgan del motor de verdad, y que ni una fila se presente
como medida.
"""

from __future__ import annotations

import itertools
from datetime import date, datetime, timezone

import numpy as np
import pytest

from app.core.prediction import engine as prediction_engine
from app.core.provenance import DATASET_KIND
from app.core.state import IMPACT_VERSION, DerivedCellState, state_at
from app.core.synthetic.cuadricula import (
    CELL_SIZE_M,
    MASTER_SEED,
    PLOT_CELLS,
    PLOT_ORDER,
    REFERENCE_CELLS,
    SCENARIO,
    SCENARIO_BY_CODE,
    build_cell_code,
    cell_index_to_local,
)
from app.core.synthetic.cuadricula_dataset import (
    ADVERSE_EVENTS,
    EVENTS,
    LABOR_EVENTS,
    PREDICTION_MOMENTS,
    SEVERITY_CEILING,
    SEVERITY_FLOOR,
    YIELD_REALIZATION_RATIO,
    _CropSpecAdapter,
    base_yield_kg_per_m2,
    build_cuadricula_dataset,
    build_manifest,
    cuadricula_uuid,
    moment,
    plot_events,
)
from app.domain.enums import ObservationType, Provenance


@pytest.fixture(scope="module")
def dataset():
    return build_cuadricula_dataset()


def muestra(iterador, n=400):
    return list(itertools.islice(iterador, n))


# --- Estructura --------------------------------------------------------------


def test_the_small_tables_have_exactly_what_the_scenario_declares(dataset):
    assert len(dataset.organizations) == 1
    assert len(dataset.farms) == 1
    assert len(dataset.plots) == 4
    assert len(dataset.crops) == 4
    assert len(dataset.crop_cycles) == 4


def test_every_plot_is_one_hectare_at_one_square_metre(dataset):
    for plot in dataset.plots:
        assert plot["grid_width"] == plot["grid_height"] == PLOT_CELLS
        assert plot["cell_size_m"] == CELL_SIZE_M
        assert plot["grid_width"] * plot["grid_height"] * plot["cell_size_m"] ** 2 == 10_000


def test_each_cycle_hangs_from_its_own_plot_and_crop(dataset):
    for cycle, plot, crop in zip(dataset.crop_cycles, dataset.plots, dataset.crops, strict=True):
        assert cycle["plot_id"] == plot["id"]
        assert cycle["crop_id"] == crop["id"]
        assert cycle["planted_at"] < cycle["expected_harvest_at"]


def test_the_cells_of_a_plot_are_ten_thousand_and_unique(dataset):
    celdas = list(dataset.iter_cells("P"))
    assert len(celdas) == 10_000
    assert len({c["id"] for c in celdas}) == 10_000
    assert len({c["cell_code"] for c in celdas}) == 10_000
    assert len({(c["x"], c["y"]) for c in celdas}) == 10_000


# --- Eventos: zonas con causa, no rangos de identificador --------------------


def test_every_adverse_event_maps_to_a_type_ceres_actually_has(dataset):
    validos = {t for t in ObservationType}
    for event in ADVERSE_EVENTS:
        assert event.observation_type in validos


def test_the_labours_are_not_disguised_as_damage():
    """NPK, fungicida, riego, cincelado y Boro/Zinc no son danos.

    No tienen tipo de observacion, no generan filas, y estan en el manifiesto.
    Meterlas como `other` con severidad las convertiria en un perjuicio.
    """
    assert len(LABOR_EVENTS) == 6
    for labor in LABOR_EVENTS:
        assert labor.observation_type is None
        assert labor.truth_damage == 0.0
        assert labor.coverage == 0.0


def test_the_weekly_irrigation_never_becomes_invented_dates():
    """El escenario no da fechas para "riego semanal" y no se fabrican."""
    riego = next(e for e in LABOR_EVENTS if e.name == "Riego semanal")
    assert riego.observation_type is None
    assert "SIN FECHAS" in riego.note


def test_every_observation_falls_inside_its_own_zone(dataset):
    """Celda a celda: cada observacion cae en la mascara de SU evento, y no
    falta ninguna celda de la zona. Se compara el conjunto entero, no una
    muestra: `==` cubre a la vez las que sobran y las que faltan.
    """
    for code in PLOT_ORDER:
        observaciones = list(dataset.iter_observations(code))
        for event in plot_events(code):
            mask, severidad = dataset.masks[code][event.name]
            esperadas = {
                cuadricula_uuid("observation", code, event.name, str(x), str(y))
                for y, x in zip(*np.nonzero(mask), strict=True)
            }
            reales = {f["id"] for f in observaciones if f["type"] == event.observation_type.value
                      and f["description"].startswith(event.name)}
            assert reales == esperadas, f"{code} {event.name}"


def test_the_zone_of_a_wet_event_really_is_the_wet_part(dataset):
    """La zona tiene CAUSA. Si la mascara no correlaciona con el campo que la
    define, se habria pintado a mano.
    """
    campo = dataset.fields["P"]
    mask, _ = dataset.masks["P"]["Gota (Phytophthora)"]
    assert campo.humidity[mask].min() >= campo.humidity[~mask].max()


def test_the_dry_event_is_the_dry_part_and_the_flood_the_deepest(dataset):
    seco, _ = dataset.masks["M"]["Estres hidrico"]
    assert dataset.fields["M"].humidity[seco].max() <= dataset.fields["M"].humidity[~seco].min()

    hondo, _ = dataset.masks["R"]["Inundacion parcial"]
    profundidad = dataset.fields["R"].depression_m
    assert profundidad[hondo].min() >= profundidad[~hondo].max()


def test_no_adverse_zone_is_a_range_of_cell_codes(dataset):
    """LO QUE SE PIDIO EVITAR, comprobado directamente.

    Si una zona fuera "de la celda 3000 a la 4500", los indices afectados
    formarian un intervalo contiguo. Se exige lo contrario: que el conjunto este
    partido en muchos tramos, que es lo que produce una mascara espacial sobre
    una malla recorrida por filas.
    """
    for code in PLOT_ORDER:
        for event in plot_events(code):
            mask, _ = dataset.masks[code][event.name]
            indices = np.sort(np.flatnonzero(mask.ravel()))
            saltos = int((np.diff(indices) > 1).sum()) + 1
            assert saltos > 20, f"{code} {event.name}: solo {saltos} tramos"


def test_every_zone_is_spatially_contiguous_not_scattered(dataset):
    """Y al mismo tiempo NO es ruido: una zona sorteada al azar tendria casi
    tantos tramos como celdas. Las de verdad forman manchas.
    """
    for code in PLOT_ORDER:
        for event in plot_events(code):
            mask, _ = dataset.masks[code][event.name]
            indices = np.sort(np.flatnonzero(mask.ravel()))
            tramos = int((np.diff(indices) > 1).sum()) + 1
            assert tramos < len(indices) / 4, f"{code} {event.name}: zona dispersa"


def test_the_zone_covers_the_declared_fraction(dataset):
    """La cobertura declarada se cumple, con el margen que dejan los empates.

    La zona de borde puntua por distancia al margen, que es un entero: el
    cuantil cae sobre un anillo completo y lo mete o lo deja fuera entero. Con
    un anillo de 100 celdas sobre 10.000 eso es un punto porcentual, y no se
    puede afinar mas sin partir el anillo por la mitad, que seria peor.
    """
    for code in PLOT_ORDER:
        for event in plot_events(code):
            mask, _ = dataset.masks[code][event.name]
            assert abs(mask.mean() - event.coverage) <= 0.011, f"{code} {event.name}"


def test_severity_comes_from_the_field_and_stays_in_range(dataset):
    for code in PLOT_ORDER:
        for event in plot_events(code):
            mask, severidad = dataset.masks[code][event.name]
            dentro = severidad[mask]
            assert dentro.min() >= SEVERITY_FLOOR - 1e-9
            assert dentro.max() <= SEVERITY_CEILING + 1e-9
            assert dentro.std() > 0.0
            assert (severidad[~mask] == 0).all()


# --- Procedencia -------------------------------------------------------------


def test_not_one_observation_is_presented_as_measured(dataset):
    for code in PLOT_ORDER:
        for fila in muestra(dataset.iter_observations(code), 800):
            assert fila["source_kind"] == Provenance.SYNTHETIC.value


def test_nobody_is_credited_as_the_author(dataset):
    """No hay autenticacion: inventar un tecnico o un agricultor seria inventar
    procedencia. `created_by` queda NULL en observaciones y cosechas.
    """
    for code in PLOT_ORDER:
        for fila in muestra(dataset.iter_observations(code), 50):
            assert fila["created_by"] is None
        for fila in muestra(dataset.iter_harvests(code), 50):
            assert fila["created_by"] is None


# --- La verdad ---------------------------------------------------------------


def test_each_plot_sums_exactly_to_its_target(dataset):
    """REGLA 8, sobre las filas que de verdad se insertan."""
    for crop in SCENARIO:
        total = sum(f["actual_yield_kg"] for f in dataset.iter_harvests(crop.code))
        objetivo = crop.target_t_per_ha * 1000.0
        assert abs(total - objetivo) < 1.0, f"{crop.code}: {total} vs {objetivo}"


def test_the_yield_is_never_spread_evenly(dataset):
    """REGLA 9. Repartir el promedio daria sigma 0 y aun asi cuadraria la suma.

    El criterio que importa es la dispersion relativa. El recuento de valores
    distintos es solo un cinturon extra, y va holgado a proposito: las cifras se
    guardan con cuatro decimales, asi que en un lote de rango estrecho --maiz va
    de 0,25 a 1,04 kg-- hay colisiones de redondeo inevitables que no tienen
    nada que ver con la uniformidad.
    """
    for crop in SCENARIO:
        valores = np.array([f["actual_yield_kg"] for f in dataset.iter_harvests(crop.code)])
        # El criterio que importa: dispersion relativa.
        assert valores.std() > 0.05 * valores.mean(), crop.code
        # Y que la distribucion no este concentrada en unos pocos valores, que
        # es como se veria un reparto uniforme con ruido encima. Contar valores
        # distintos a secas no sirve: se guardan con cuatro decimales, y en un
        # lote de rango estrecho --maiz va de 0,34 a 0,92 kg-- las colisiones de
        # redondeo son inevitables y no dicen nada sobre la uniformidad.
        repetido = np.bincount(np.unique(valores, return_inverse=True)[1]).max()
        assert repetido < 0.01 * valores.size, crop.code
        assert np.percentile(valores, 75) > np.percentile(valores, 25), crop.code


def morans_i(field: np.ndarray) -> float:
    """Autocorrelacion espacial con vecindad de torre. Ver el test de campo."""
    z = field - field.mean()
    denominador = float((z**2).sum())
    if denominador == 0:
        return 0.0
    cruzados = float((z[:, :-1] * z[:, 1:]).sum() + (z[:-1, :] * z[1:, :]).sum())
    pares = z.shape[0] * (z.shape[1] - 1) + (z.shape[0] - 1) * z.shape[1]
    return (z.size / (2.0 * pares)) * (2.0 * cruzados) / denominador


def test_the_variation_has_spatial_causes_not_noise(dataset):
    """El rendimiento real tiene que ser un CAMPO, no ruido con la media buena.

    Se mide con autocorrelacion espacial, no contra una variable concreta. Antes
    se comparaba con `health_factor` dando por hecho que era la causa dominante,
    y dejo de serlo al corregir la topografia: con los cuatro lotes cerca de su
    humedad ideal la sanidad quedo casi plana --zanahoria, 0,79 a 0,98-- y el
    rendimiento pasa a explicarse por suelo, densidad y eventos. Aquel test
    comprobaba un supuesto mio, no un requisito del dataset.

    La autocorrelacion si es el requisito: distingue un campo de un sorteo, sea
    cual sea la variable que acabe dominando. Es el mismo criterio de sanidad
    que el resto del dataset, con el mismo umbral y las mismas reservas.
    """
    for crop in SCENARIO:
        i = morans_i(dataset.truth[crop.code])
        assert i > 0.5, f"{crop.code}: Moran's I del rendimiento = {i:.3f}"


def test_a_shuffled_yield_would_fail_that_criterion(dataset):
    """Que el criterio sirva de algo: los mismos valores desordenados no pasan.

    Misma media, misma desviacion y misma suma por lote. Lo unico que se pierde
    al barajarlos es la estructura espacial, que es justo lo que se comprueba.
    """
    revuelto = dataset.truth["P"].ravel().copy()
    np.random.default_rng(0).shuffle(revuelto)

    assert morans_i(revuelto.reshape(PLOT_CELLS, PLOT_CELLS)) < 0.1


def test_the_damaged_zones_yield_less_than_the_rest(dataset):
    for code in PLOT_ORDER:
        verdad = dataset.truth[code]
        for event in plot_events(code):
            mask, _ = dataset.masks[code][event.name]
            assert verdad[mask].mean() < verdad[~mask].mean(), f"{code} {event.name}"


def test_the_healthy_reference_cell_outyields_the_damaged_one(dataset):
    """Coherencia con el escenario: en los cuatro lotes, la celda declarada sana
    rinde mas que la declarada afectada.
    """
    parejas = [("P", 1, 8550), ("M", 500, 4500), ("Z", 2000, 8000), ("R", 1000, 9500)]
    for code, sana, afectada in parejas:
        xs, ys = cell_index_to_local(sana)
        xa, ya = cell_index_to_local(afectada)
        assert dataset.truth[code][ys, xs] > dataset.truth[code][ya, xa], code


def test_every_harvest_belongs_to_its_own_cycle(dataset):
    for crop in SCENARIO:
        esperado = cuadricula_uuid("crop_cycle", crop.code)
        for fila in muestra(dataset.iter_harvests(crop.code), 300):
            assert fila["crop_cycle_id"] == esperado
            assert fila["harvested_at"] == date.fromisoformat(crop.harvested_at)
            assert fila["actual_yield_kg"] >= 0
            assert fila["actual_boxes"] >= 0


# --- Las predicciones salen del motor real -----------------------------------


def test_the_predictions_come_from_the_real_engine(dataset):
    """LA PRUEBA DE QUE EL GENERADOR NO REIMPLEMENTO EL MODELO.

    Se vuelve a calcular desde fuera con `state_at` + `predict` --lo mismo que
    hace `services/predictions.py`-- y tiene que coincidir EXACTAMENTE. Si el
    generador copiara la formula, cualquier cambio en el motor romperia este
    test en vez de pasar desapercibido.
    """
    crop = SCENARIO_BY_CODE["P"]
    campo = dataset.fields["P"]
    spec = _CropSpecAdapter(
        slug=crop.crop_slug,
        base_yield_kg_per_m2=base_yield_kg_per_m2(crop),
        box_capacity_kg=crop.box_capacity_kg,
        optimal_plant_density_per_m2=crop.optimal_density_per_m2,
    )

    for fila in muestra(dataset.iter_predictions("P"), 120):
        cx, cy = cell_index_to_local(int(fila["inputs"]["cell_code"].split("-")[1]))
        base = DerivedCellState(
            cell_code=build_cell_code("P", cx, cy),
            elevation_m=float(campo.elevation_m[cy, cx]),
            slope_deg=float(campo.slope_deg[cy, cx]),
            soil_quality=float(campo.soil_quality[cy, cx]),
            plant_density=float(campo.plant_density[cy, cx]),
            health_factor=float(campo.health_factor[cy, cx]),
            base_yield_factor=float(campo.base_yield_factor[cy, cx]),
        )
        estado = state_at(base, dataset._cell_events("P", cx, cy), fila["as_of"], DATASET_KIND)
        esperado = prediction_engine.predict(estado, spec, area_m2=CELL_SIZE_M**2)

        assert fila["projected_yield_kg"] == esperado.projected_yield_kg
        assert fila["projected_boxes"] == esperado.projected_boxes
        assert fila["risk_score"] == esperado.risk_score
        assert fila["risk_level"] == esperado.risk_level.value
        assert fila["factors"] == esperado.factors.as_dict()


def test_the_final_yield_never_enters_the_prediction(dataset):
    """REGLA 12, garantizada por firma y comprobada aqui.

    `inputs` es la copia exacta de lo que consumio el motor. Si el rendimiento
    real se hubiera colado, apareceria en ese diccionario.
    """
    prohibidos = {"actual_yield_kg", "yield_kg", "truth", "harvest", "humidity"}
    for fila in muestra(dataset.iter_predictions("R"), 60):
        assert prohibidos.isdisjoint(fila["inputs"].keys())
        assert prohibidos.isdisjoint(fila["factors"].keys())


def test_there_are_two_predictions_per_cell(dataset):
    """Dos y no tres, y la razon esta escrita en `PREDICTION_MOMENTS`.

    El momento intermedio derivaba EL MISMO estado que el final en papa y en
    zanahoria --todos sus eventos ocurren antes, e `impact-v0` no modela
    recuperacion ni crecimiento--, asi que 20.000 predicciones repetian otras
    20.000. El dataset baja de 120.000 filas a 80.000 sin perder informacion.
    """
    assert all(len(momentos) == 2 for momentos in PREDICTION_MOMENTS.values())

    por_celda: dict[str, set[datetime]] = {}
    for fila in muestra(dataset.iter_predictions("Z"), 30):
        por_celda.setdefault(fila["inputs"]["cell_code"], set()).add(fila["as_of"])
    assert any(len(momentos) == 2 for momentos in por_celda.values())


def test_every_prediction_precedes_its_harvest(dataset):
    """Los tres `as_of` caen antes del corte de la cosecha (00:00 UTC del dia),
    asi que los tres emparejan con la regla temporal de la migracion 0007.
    """
    from app.domain.performance import prediction_precedes_harvest

    for crop in SCENARIO:
        cosecha = date.fromisoformat(crop.harvested_at)
        for dia in PREDICTION_MOMENTS[crop.code]:
            assert prediction_precedes_harvest(moment(dia), cosecha), f"{crop.code} {dia}"


def test_the_prediction_moments_are_spread_across_the_cycle(dataset):
    """~30 dias tras siembra, etapa critica, y una semana antes de cosecha."""
    for crop in SCENARIO:
        t0, t2 = (date.fromisoformat(d) for d in PREDICTION_MOMENTS[crop.code])
        siembra = date.fromisoformat(crop.planted_at)
        cosecha = date.fromisoformat(crop.harvested_at)
        assert 25 <= (t0 - siembra).days <= 35
        assert t0 < t2
        assert 5 <= (cosecha - t2).days <= 10


def test_the_first_moment_sees_no_event_and_the_last_sees_them_all(dataset):
    """Sin esto los dos momentos derivarian el mismo estado y no habria eje.

    t0 tiene que caer ANTES del primer evento adverso --si no, deja de ser "lo
    que CERES estimaba al principio"-- y t2 despues del ultimo.
    """
    for code in PLOT_ORDER:
        t0, t2 = (moment(d) for d in PREDICTION_MOMENTS[code])
        fechas = [e.occurred_at for e in plot_events(code)]
        assert all(f > t0 for f in fechas), f"{code}: t0 ya ve un evento"
        assert all(f < t2 for f in fechas), f"{code}: t2 no ve todos los eventos"


def test_the_model_version_names_both_models(dataset):
    for fila in muestra(dataset.iter_predictions("M"), 20):
        assert IMPACT_VERSION in fila["model_version"]
        assert fila["model_version"].startswith("rule-based")


def test_the_events_actually_move_the_state(dataset):
    """REGLA 11 de extremo a extremo: t0 -> evento -> t1 produce OTRO estado.

    Se comprueba sobre una celda dentro de una zona. Que el error de CERES suba
    o baje con el tiempo no se comprueba en ninguna parte, y es deliberado: eso
    lo decide el motor, no el generador.
    """
    mask, _ = dataset.masks["P"]["Gota (Phytophthora)"]
    ys, xs = np.nonzero(mask)
    y, x = int(ys[0]), int(xs[0])
    campo = dataset.fields["P"]
    base = DerivedCellState(
        cell_code=build_cell_code("P", x, y),
        elevation_m=float(campo.elevation_m[y, x]),
        slope_deg=float(campo.slope_deg[y, x]),
        soil_quality=float(campo.soil_quality[y, x]),
        plant_density=float(campo.plant_density[y, x]),
        health_factor=float(campo.health_factor[y, x]),
        base_yield_factor=float(campo.base_yield_factor[y, x]),
    )
    eventos = dataset._cell_events("P", x, y)
    t0, t2 = (moment(d) for d in PREDICTION_MOMENTS["P"])

    antes = state_at(base, eventos, t0, DATASET_KIND)
    despues = state_at(base, eventos, t2, DATASET_KIND)

    assert antes.applied == 0
    assert despues.applied >= 1
    assert despues.health_factor < antes.health_factor


# --- Calibracion ciega -------------------------------------------------------


def test_the_potential_is_set_by_one_blind_rule_for_all_four_crops(dataset):
    """No se ajusta por lote ni despues de ver los errores.

    Si alguien retocara el ratio para que CERES acertara mas, el dataset dejaria
    de servir para medir si CERES se equivoca.
    """
    for crop in SCENARIO:
        assert base_yield_kg_per_m2(crop) == pytest.approx(
            crop.target_kg_per_cell / YIELD_REALIZATION_RATIO, rel=1e-6
        )


def test_the_truth_model_is_not_the_prediction_model():
    """Los danos de la verdad y los de `impact-v0` son distintos a proposito.

    Si coincidieran, el error de CERES solo mediria el ruido.
    """
    from app.core.state import HEALTH_IMPACT
    from app.core.synthetic.cuadricula_dataset import (
        TRUTH_DAMAGE_DISEASE,
        TRUTH_DAMAGE_PHYSICAL,
        TRUTH_DAMAGE_WATER_STRESS,
    )

    assert TRUTH_DAMAGE_DISEASE != HEALTH_IMPACT[ObservationType.DISEASE]
    assert TRUTH_DAMAGE_WATER_STRESS != HEALTH_IMPACT[ObservationType.WATER_STRESS]
    assert TRUTH_DAMAGE_PHYSICAL != HEALTH_IMPACT[ObservationType.PHYSICAL_DAMAGE]


# --- Reproducibilidad e idempotencia -----------------------------------------


def test_two_runs_produce_identical_rows():
    uno = build_cuadricula_dataset(MASTER_SEED)
    otro = build_cuadricula_dataset(MASTER_SEED)

    assert uno.organizations == otro.organizations
    assert uno.farms == otro.farms
    assert uno.plots == otro.plots
    assert muestra(uno.iter_cells("P"), 500) == muestra(otro.iter_cells("P"), 500)
    assert muestra(uno.iter_harvests("R"), 500) == muestra(otro.iter_harvests("R"), 500)
    assert muestra(uno.iter_predictions("M"), 300) == muestra(otro.iter_predictions("M"), 300)


def test_the_ids_are_stable_so_a_second_load_cannot_duplicate(dataset):
    """Los UUID v5 salen de una clave legible, no de un contador ni del reloj.

    Es lo que hace que `ON CONFLICT (id) DO NOTHING` baste para la idempotencia.
    """
    otro = build_cuadricula_dataset(MASTER_SEED)
    for a, b in zip(muestra(dataset.iter_cells("Z"), 200), muestra(otro.iter_cells("Z"), 200),
                    strict=True):
        assert a["id"] == b["id"]
    assert dataset.farms[0]["id"] == otro.farms[0]["id"]


def test_the_ids_do_not_collide_with_the_demo_farm(dataset):
    from app.core.synthetic.demo import demo_uuid

    assert dataset.farms[0]["id"] != demo_uuid("farm", "ceres-demo-farm")
    assert dataset.organizations[0]["id"] != demo_uuid("organization", "ceres-demo")


# --- Manifiesto --------------------------------------------------------------


def test_the_manifest_says_what_it_has_to_say(dataset):
    manifiesto = build_manifest(dataset, generated_at=datetime(2026, 9, 8, tzinfo=timezone.utc))

    assert manifiesto["headline"] == "Dataset sintetico de prueba de CERES."
    assert manifiesto["provenance"]["dataset_kind"] == "synthetic"
    assert manifiesto["provenance"]["measured_rows"] == 0
    assert manifiesto["generator"]["seed"] == MASTER_SEED
    assert manifiesto["generator"]["version"]
    assert manifiesto["generator"]["generated_at"].startswith("2026-09-08")

    for clave in ("del_escenario", "supuestos_sinteticos", "variables_latentes",
                  "topografia", "eventos", "rendimiento", "sin_leakage", "anclajes"):
        assert clave in manifiesto, clave

    assert len(manifiesto["anclajes"]) == 8
    assert len(manifiesto["eventos"]["adversos"]) == 6
    assert len(manifiesto["eventos"]["labores_no_almacenadas"]) == 6
    assert "humidity" in manifiesto["variables_latentes"]


def test_the_manifest_publishes_the_anchor_deviations(dataset):
    """Las desviaciones se publican en vez de esconderse."""
    manifiesto = build_manifest(dataset)
    for ancla in manifiesto["anclajes"]:
        assert "declarado" in ancla and "generado" in ancla
        assert ancla["generado"]["elevation_m"] is not None
        assert ancla["generado"]["yield_kg"] is not None
