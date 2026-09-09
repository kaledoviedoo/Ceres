"""La resolucion efectiva que declara la API se MIDE, no se afirma.

`ELEVATION_EFFECTIVE_RESOLUTION_M = 5.0` es la unica cifra del bloque de
procedencia que no se lee de otro sitio: la nominal sale de `cell_size_m`, el
metodo y el generador son nombres, y el resto es vocabulario. Esta se calcula.

Si alguien cambia el generador y el campo gana estructura, la cifra deja de ser
cierta sin que nada mas lo note. Por eso se vuelve a medir aqui.
"""

from __future__ import annotations

import numpy as np

from app.core import provenance as declarado
from app.core.synthetic.demo import DEFAULT_SEED
from app.core.synthetic.field import generate_cell_features

LADO = 20


def _fraccion_reconstruida(elevacion: np.ndarray, componentes: int) -> float:
    """Que parte del campo reconstruyen los `componentes` mayores valores singulares."""
    centrado = elevacion - elevacion.mean()
    singulares = np.linalg.svd(centrado, compute_uv=False)
    energia = singulares**2
    return float(energia[:componentes].sum() / energia.sum())


def test_the_synthetic_elevation_has_about_four_degrees_of_freedom():
    """400 valores, cuatro grados de libertad.

    Un terreno con 400 medidas independientes necesitaria del orden de veinte
    componentes para llegar al 99 %. Este necesita cuatro, porque el generador
    lo construye con unos pocos parametros: constante + rampa + ruido de
    reticula + gaussiana.
    """
    campo = generate_cell_features(
        width=LADO, height=LADO, seed=DEFAULT_SEED, cell_size_m=1.0
    )
    fraccion = _fraccion_reconstruida(
        campo.elevation_m, declarado.ELEVATION_EFFECTIVE_RANK
    )

    assert fraccion >= declarado.ELEVATION_EFFECTIVE_VARIANCE, (
        f"{declarado.ELEVATION_EFFECTIVE_RANK} componentes reconstruyen "
        f"{fraccion:.5f}; la procedencia declara al menos "
        f"{declarado.ELEVATION_EFFECTIVE_VARIANCE}"
    )


def test_the_declared_effective_resolution_matches_that_measurement():
    """De cuatro grados de libertad sobre 20 m salen rasgos de unos 5 m.

    No es una coincidencia numerica que haya que recordar: es la division, y se
    comprueba para que cambiar una constante sin la otra falle.
    """
    esperado = LADO / declarado.ELEVATION_EFFECTIVE_RANK

    assert declarado.ELEVATION_EFFECTIVE_RESOLUTION_M == esperado


def test_the_effective_resolution_is_worse_than_the_nominal_one():
    """Si fueran iguales, subdividir la malla ganaria detalle. No lo gana."""
    assert declarado.ELEVATION_EFFECTIVE_RESOLUTION_M > 1.0


def test_the_deployment_never_declares_measured_by_default():
    """El unico valor que no se puede afirmar sin haberlo medido en campo."""
    from app.domain.enums import Provenance

    assert declarado.DATASET_KIND is not Provenance.MEASURED


# =============================================================================
# LA SEGUNDA FUENTE: La Cuadricula
#
# Su terreno se construye de otra manera y NO tiene la misma resolucion
# efectiva. Servirle los 5 m de la finca demo seria prometer veinticinco veces
# mas detalle del que el campo tiene, sobre una malla que ademas es nominalmente
# de 1 m. Por eso la procedencia se elige por finca, y la cifra se vuelve a
# medir aqui igual que la otra.
# =============================================================================

LADO_CUADRICULA = 100


def test_the_cuadricula_elevation_has_the_structure_its_provenance_declares():
    from app.core.synthetic.cuadricula import build_all_fields

    for code, campo in build_all_fields().items():
        fraccion = _fraccion_reconstruida(
            campo.elevation_m, declarado.CUADRICULA_ELEVATION_EFFECTIVE_RANK
        )
        assert fraccion >= declarado.ELEVATION_EFFECTIVE_VARIANCE, (
            f"lote {code}: {declarado.CUADRICULA_ELEVATION_EFFECTIVE_RANK} componentes "
            f"reconstruyen {fraccion:.5f}"
        )


def test_the_declared_cuadricula_resolution_matches_that_measurement():
    esperado = LADO_CUADRICULA / declarado.CUADRICULA_ELEVATION_EFFECTIVE_RANK

    assert declarado.CUADRICULA_ELEVATION_EFFECTIVE_RESOLUTION_M == round(esperado, 1)


def test_the_two_generators_are_not_described_with_the_same_numbers():
    """Si alguien vuelve a fundir las dos fuentes en una, esto se cae.

    Es el fallo que hubo: `/plots/{id}/cells` atribuia las celdas de La
    Cuadricula al generador de la finca demo y les servia 5 m de resolucion
    efectiva teniendo 33.
    """
    demo = declarado.DEMO_SOURCE
    cuadricula = declarado.CUADRICULA_SOURCE

    assert demo.generator != cuadricula.generator
    assert demo.elevation_method != cuadricula.elevation_method
    assert (
        demo.elevation_effective_resolution_m
        != cuadricula.elevation_effective_resolution_m
    )


def test_an_unknown_farm_falls_back_to_the_conservative_description():
    import uuid

    assert declarado.source_for_farm(None) is declarado.DEMO_SOURCE
    assert declarado.source_for_farm(uuid.uuid4()) is declarado.DEMO_SOURCE


def test_the_cuadricula_farm_is_recognised_by_its_own_id():
    from app.core.synthetic.cuadricula import FARM_ID

    assert declarado.source_for_farm(FARM_ID) is declarado.CUADRICULA_SOURCE
