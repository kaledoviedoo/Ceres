"""Que se puede demostrar de `slope_deg`, y que no.

La pendiente NO es una capa y no va a serlo todavia. Estos tests no la preparan
para serlo: fijan lo que hoy se puede afirmar de ella y MIDEN lo que no.

Tres de las cuatro condiciones se demuestran. La cuarta —que el paso de la
derivada sea compatible con la resolucion efectiva de la fuente— no se cumple, y
el ultimo test la cuantifica en vez de fingirla. Es la razon medida de que la
capa siga fuera.
"""

from __future__ import annotations

import math

import numpy as np

from app.core import provenance as declarado
from app.core.synthetic.demo import DEFAULT_SEED
from app.core.synthetic.field import TerrainProfile, generate_cell_features

#: Rampa pura: sin ruido, sin hondonada. Solo el gradiente sur-norte, que sube
#: `north_rise_m` a lo largo del lote. El angulo es conocido de antemano.
RAMPA = TerrainProfile(
    north_rise_m=5.0,
    elevation_noise_m=0.0,
    critical_elevation_drop_m=0.0,
    critical_health_penalty=0.0,
    critical_soil_penalty=0.0,
)


def _angulo_esperado(subida_m: float, celdas: int, cell_size_m: float) -> float:
    """El angulo de una rampa que sube `subida_m` en `(celdas - 1)` pasos."""
    return math.degrees(math.atan(subida_m / ((celdas - 1) * cell_size_m)))


# --- 1 · Se deriva de la elevacion -------------------------------------------


def test_slope_depends_only_on_elevation():
    """Cambiar suelo, sanidad y densidad no mueve un solo grado.

    Es la comprobacion de que `slope_deg` es una funcion de la elevacion y de
    nada mas: mismas semillas, mismos parametros de terreno, entradas
    agronomicas completamente distintas.
    """
    terreno = dict(elevation_noise_m=0.0, critical_elevation_drop_m=0.0)
    a = generate_cell_features(width=12, height=12, seed=3, profile=TerrainProfile(**terreno))
    b = generate_cell_features(
        width=12,
        height=12,
        seed=3,
        profile=TerrainProfile(
            **terreno, soil_base=0.9, health_base=0.2, target_plant_density=4.0
        ),
    )

    assert np.array_equal(a.elevation_m, b.elevation_m)
    assert np.array_equal(a.slope_deg, b.slope_deg)
    # Y el control: las entradas agronomicas SI cambiaron, o el test no probaria nada.
    assert not np.array_equal(a.soil_quality, b.soil_quality)


# --- 2 · Nunca sobre la elevacion exagerada ----------------------------------


def test_the_backend_has_no_vertical_exaggeration_to_apply():
    """La exageracion ×2,2 es una decision de PRESENTACION y vive en el frontend.

    Aqui se comprueba por ausencia, que es la forma mas fuerte: no existe la
    constante, asi que la pendiente no puede haberla usado. Si alguien la
    trajera al backend, este test obliga a justificarlo.
    """
    import app.core.synthetic.field as generador

    assert not hasattr(generador, "VERTICAL_EXAGGERATION")
    fuente = (generador.__file__ or "")
    assert fuente
    with open(fuente, encoding="utf-8") as f:
        texto = f.read()
    assert "2.2" not in texto, "aparece un factor sospechoso en el generador"


def test_slope_is_consistent_with_the_real_metres_of_relief():
    """La pendiente sale de metros reales, no de unidades de dibujo.

    Con la exageracion aplicada, una rampa de 5 m en 20 m daria 47,7° en vez de
    14,04°. La diferencia es tan grande que no hace falta interpretarla.
    """
    lado = 21
    campo = generate_cell_features(width=lado, height=lado, seed=7, profile=RAMPA)
    interior = campo.slope_deg[1:-1, 1:-1]

    real = _angulo_esperado(5.0, lado, 1.0)
    exagerado = math.degrees(math.atan(5.0 * 2.2 / (lado - 1)))

    assert interior.mean() == round(real, 10) or abs(interior.mean() - real) < 1e-9
    assert abs(interior.mean() - exagerado) > 5.0


# --- 3 · Una rampa de angulo conocido da el angulo esperado ------------------


def test_a_known_ramp_produces_the_expected_angle():
    """La comprobacion mas directa que admite el codigo actual.

    Se ejecuta el generador REAL —no una reimplementacion de la formula— sobre
    un perfil sin ruido, y se compara con la trigonometria.
    """
    for lado, paso in ((21, 1.0), (21, 2.0), (11, 1.0)):
        campo = generate_cell_features(
            width=lado, height=lado, seed=7, cell_size_m=paso, profile=RAMPA
        )
        interior = campo.slope_deg[1:-1, 1:-1]
        esperado = _angulo_esperado(5.0, lado, paso)

        assert interior.min() == interior.max(), "una rampa pura no tiene pendiente variable"
        assert abs(interior.mean() - esperado) < 1e-6, f"lado={lado} paso={paso}"


def test_the_angle_follows_cell_size_m():
    """Doblar el lado de la celda alarga la rampa y la aplana a la mitad.

    Es la misma garantia que la geometria del frontend, del lado del servidor: la
    pendiente es Δaltura / Δdistancia FISICA, no por celda.
    """
    fina = generate_cell_features(width=21, height=21, seed=7, cell_size_m=1.0, profile=RAMPA)
    gruesa = generate_cell_features(width=21, height=21, seed=7, cell_size_m=2.0, profile=RAMPA)

    tan_fina = math.tan(math.radians(fina.slope_deg[10, 10]))
    tan_gruesa = math.tan(math.radians(gruesa.slope_deg[10, 10]))

    assert abs(tan_fina / tan_gruesa - 2.0) < 1e-9


# --- 4 · Lo que NO se cumple, medido ----------------------------------------


def test_the_derivative_step_is_finer_than_the_effective_resolution():
    """LA CONDICION QUE NO SE CUMPLE, Y POR CUANTO.

    `np.gradient` deriva con el paso de la malla —1 m— sobre un campo cuya
    variacion real ocurre cada 5 m. Derivar mas fino que la escala a la que el
    dato tiene estructura no describe el terreno: describe el interpolador que
    lo suaviza.

    Este test no falla: MIDE. Es el argumento cuantitativo de que la pendiente
    siga fuera de las capas, y el dia que entre un DEM real con resolucion
    efectiva de 1 m dejara de tener sentido y habra que borrarlo.
    """
    campo = generate_cell_features(width=20, height=20, seed=DEFAULT_SEED, cell_size_m=1.0)
    paso_efectivo = declarado.ELEVATION_EFFECTIVE_RESOLUTION_M

    # El paso real de la derivada es el de la malla.
    assert paso_efectivo > 1.0, "si esto deja de ser cierto, la pendiente ya es defendible"

    # La misma pendiente medida a la escala a la que el campo varia de verdad.
    submuestreado = campo.elevation_m[:: int(paso_efectivo), :: int(paso_efectivo)]
    gy, gx = np.gradient(submuestreado, paso_efectivo, paso_efectivo)
    a_escala_efectiva = np.degrees(np.arctan(np.hypot(gx, gy)))

    exagerada = campo.slope_deg.max() / a_escala_efectiva.max()

    # Medido sobre el dataset actual: derivar a 1 m mas que DOBLA la pendiente
    # que el terreno tiene a la escala en la que existe.
    assert exagerada > 2.0, f"la relacion medida es {exagerada:.2f}x"
    assert campo.slope_deg.max() > 20.0
    assert a_escala_efectiva.max() < 10.0
