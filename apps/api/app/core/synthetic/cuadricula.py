"""LA CUADRICULA - finca sintetica de prueba de CERES.

DATASET SINTETICO DE PRUEBA DE CERES. Ni la finca, ni las celdas, ni las
observaciones, ni las cosechas corresponden a ningun cliente ni a ninguna
medicion de campo. Todo lo que sale de aqui es `synthetic`.

QUE ES ESTE MODULO
------------------
Genera el CAMPO de la finca: una superficie continua de 220 x 220 m de la que se
recortan cuatro lotes de 1 ha, y las variables por celda que se derivan de ella.
No toca la base de datos y no construye filas: eso es `cuadricula_dataset`.

LA CADENA, y es lo que separa esto de cuatro sorteos independientes
------------------------------------------------------------------

    topografia --gradient--> pendiente
        |
        +--depresion local--> HUMEDAD (latente, no se guarda)
                                 |
            +--------------------+--------------------+
            v                    v                    v
        suelo               sanidad t0          zonas de evento
            |                    |
            +--------+-----------+
                     v
              densidad de siembra

Ninguna variable se sortea por su cuenta. Cada una recibe lo que le llega de la
anterior y anade su propio ruido espacial suave.

POR QUE LA HUMEDAD ES LATENTE
-----------------------------
`grid_cells` no tiene columna de humedad y esta fase no la crea. La humedad
gobierna el escenario entero pero NUNCA se guarda ni se sirve, asi que CERES
solo la ve de refilon, a traves de `soil_quality` y `health_factor`.

Eso no es una carencia del dataset: es la fuente de error honesta que hace util
la finca. La diferencia entre lo que CERES predice y lo que se cosecho no sera
ruido que metimos a mano, sera una variable real del campo que el modelo actual
no puede observar.

LOS OCHO ANCLAJES SON LA TOPOGRAFIA, NO UNA CAPA ENCIMA
-------------------------------------------------------
El escenario declara ocho celdas de referencia con cota, humedad y pendiente. En
vez de generar un terreno y sobrescribir esos puntos --que es justo lo que se
pidio no hacer-- la superficie se AJUSTA para satisfacerlos.

Y se ajusta a las dos cosas A LA VEZ. Una version anterior solo imponia las
cotas y dejaba que la pendiente saliera como saliera: M-00500 daba 13,9 % con un
3 % declarado, y la finca llegaba al 14 % de pendiente maxima. Eso era escribir
dos datos independientes y llamar "derivada" a uno de ellos.

Ahora el ajuste minimiza a la vez:

    * la distancia a las 7 cotas declaradas,
    * la distancia a las 7 pendientes declaradas --calculadas con el MISMO
      `numpy.gradient` que produce `slope_deg` aguas abajo--,
    * y la energia de flexion de la superficie, que es lo que impide que el
      ajuste satisfaga los anclajes a base de ondular el terreno entre ellos.

Sin ese tercer termino el ajuste clavaba los catorce numeros y devolvia una
finca con 36 % de pendiente maxima: cumplia los puntos y era un cartón de
huevos. Con el, el sistema elige la superficie MAS SUAVE compatible con lo
declarado. Medido sobre los siete anclajes:

    error de cota      <= 0,46 m   (media 0,21)
    error de pendiente <= 5,7 pts  (media 1,3), y sin M-00500 <= 1,2
    pendiente de la finca: media 5,0 %, p99 10,3 %, maxima 11,2 %

La version anterior daba 10,9 puntos de error de pendiente y un 14,0 % maximo.

Los rasgos del terreno no se dibujan: salen del ajuste.

    P-08550   VAGUADA en el centro-norte de papa -> zona humeda -> gota
    M-04500   LOMA de maiz -> zona seca y empinada -> estres hidrico
    Z-02000   zanahoria sobre el bajo amplio del suroeste
    R-09500   HONDONADA CERRADA de remolacha -> encharcamiento

LO QUE SIGUE SIN CUADRAR, y por que. Entre M-00500 (2108 m) y M-04500 (2112 m)
hay 40 m: eso son 10 % de pendiente media, y el escenario etiqueta esas dos
celdas como 3 % y 8 %. Un perfil suave que pase por las dos cotas con esas dos
pendientes en los extremos necesita ~12 % en el medio, asi que las tres cosas no
pueden ser ciertas a la vez: no es un fallo del ajuste, es una contradiccion de
los datos de partida. El ajuste reparte el desacuerdo en vez de esconderlo, y se
lo carga casi entero a M-00500 (8,7 % frente al 3 % declarado) porque es la
unica de las dos que puede moverse sin romper nada mas. La desviacion de cada
anclaje se mide en `tests/unit/test_cuadricula_field.py` y se publica en el
manifiesto.

Convencion de ejes: x = 0 oeste, y = 0 sur.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from app.core.synthetic.noise import smooth_noise

#: Version del generador. Viaja en el manifiesto. Cambiarla es la forma de decir
#: que un dataset regenerado NO es comparable con el anterior.
GENERATOR_VERSION = "cuadricula-v1"

#: Semilla maestra del escenario.
MASTER_SEED = 2026

#: Metros por grado de latitud. Igual que en `field.py`.
METERS_PER_DEGREE_LATITUDE = 111_320.0

# =============================================================================
# EL ESCENARIO. Todo lo de este bloque viene dado; nada se invento aqui.
# =============================================================================

FARM_NAME = "La Cuadricula"
FARM_REGION = "Monquira, Villa de Leyva, Boyaca"
FARM_COUNTRY = "CO"
FARM_LATITUDE = 5.6375
FARM_LONGITUDE = -73.5264

#: Identidad de la finca. Vive aqui, y no en `cuadricula_dataset`, porque
#: `app.core.provenance` necesita saber que filas genero este modulo para no
#: atribuirlas al generador de la finca demo, y no puede importar el ensamblador
#: sin crear un ciclo. Este modulo no importa nada de `app` salvo el ruido.
ORGANIZATION_SLUG = "la-cuadricula"
ORGANIZATION_NAME = "La Cuadricula (finca sintetica de prueba)"

#: Namespace propio: los UUID de esta finca no pueden chocar con los de la demo.
CUADRICULA_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_DNS, "cuadricula.ceres.local")


def cuadricula_uuid(*parts: str) -> uuid.UUID:
    """UUID v5 estable. Regenerar produce exactamente los mismos ids."""
    return uuid.uuid5(CUADRICULA_NAMESPACE, ":".join(parts))


FARM_ID = cuadricula_uuid("farm", ORGANIZATION_SLUG)

PLOT_CELLS = 100
CELL_SIZE_M = 1.0
#: Calle sin cultivar entre lotes. Existe para que los lotes no se toquen y la
#: superficie compartida se vea en los bordes.
ALLEY_M = 20
FARM_SPAN = 2 * PLOT_CELLS + ALLEY_M  # 220 m de lado

#: Esquina suroeste de cada lote dentro de la malla de finca, en metros.
#: NO=Papa  NE=Maiz  SO=Zanahoria  SE=Remolacha. La disposicion no es libre: es
#: la unica de las posibles que hace compatibles las ocho cotas declaradas con
#: una pendiente regional agricola (ver `build_farm_surface`).
PLOT_ORIGIN: dict[str, tuple[int, int]] = {
    "P": (0, PLOT_CELLS + ALLEY_M),
    "M": (PLOT_CELLS + ALLEY_M, PLOT_CELLS + ALLEY_M),
    "Z": (0, 0),
    "R": (PLOT_CELLS + ALLEY_M, 0),
}

PLOT_ORDER: tuple[str, ...] = ("P", "M", "Z", "R")


@dataclass(frozen=True, slots=True)
class CropScenario:
    """Un lote y su cultivo, tal como los declara el escenario."""

    code: str
    plot_name: str
    crop_name: str
    crop_slug: str
    variety: str | None
    planted_at: str
    harvested_at: str
    #: Rendimiento objetivo del lote (t/ha) y su equivalente por celda (kg).
    target_t_per_ha: float
    target_kg_per_cell: float
    #: Humedad ideal del cultivo, 0..1. Declarada por el escenario.
    ideal_humidity: float
    #: pH historico del lote. Latente: no hay columna para el.
    ph: float
    #: Densidad de siembra de referencia (plantas/m2), tomada de las celdas de
    #: referencia SANAS del propio escenario, no de literatura.
    optimal_density_per_m2: float
    #: kg por caja de cosecha. SUPUESTO SINTETICO.
    box_capacity_kg: float
    #: Duracion del ciclo en dias. Se deriva de las dos fechas declaradas.
    cycle_days: int


SCENARIO: tuple[CropScenario, ...] = (
    CropScenario("P", "Lote 1 - Papa Diacol", "Papa", "papa-diacol", "Diacol Capiro",
                 "2026-03-15", "2026-08-20", 33.5, 3.35, 0.65, 5.8, 4.0, 50.0, 158),
    CropScenario("M", "Lote 2 - Maiz Amarillo", "Maiz", "maiz-amarillo", "Amarillo",
                 "2026-04-10", "2026-09-15", 7.5, 0.75, 0.45, 6.0, 6.0, 40.0, 158),
    CropScenario("Z", "Lote 3 - Zanahoria", "Zanahoria", "zanahoria", None,
                 "2026-05-01", "2026-08-30", 46.2, 4.62, 0.70, 6.5, 80.0, 20.0, 121),
    CropScenario("R", "Lote 4 - Remolacha", "Remolacha", "remolacha", None,
                 "2026-04-20", "2026-08-10", 27.8, 2.78, 0.60, 6.8, 45.0, 25.0, 112),
)

SCENARIO_BY_CODE: dict[str, CropScenario] = {c.code: c for c in SCENARIO}


@dataclass(frozen=True, slots=True)
class ReferenceCell:
    """Una de las ocho celdas de referencia declaradas por el escenario.

    R-09500 llega incompleta --sin cota, sin densidad, sin rendimiento-- y se
    deja incompleta. Rellenarla seria inventar.
    """

    plot_code: str
    index: int
    humidity: float
    ph: float
    elevation_m: float | None = None
    slope_pct: float | None = None
    density_per_m2: float | None = None
    organic_matter_pct: float | None = None
    ec: float | None = None
    texture: str | None = None
    condition: str = "sano"
    yield_kg: float | None = None


REFERENCE_CELLS: tuple[ReferenceCell, ...] = (
    ReferenceCell("P", 1, 0.65, 5.8, 2105.0, 2.0, 4.0, 4.2, 1.2, "franco-arenosa", "sano", 3.8),
    ReferenceCell("P", 8550, 0.78, 5.4, 2102.0, 1.0, 3.0, 4.5, 1.5, "arcillosa", "gota", 1.2),
    ReferenceCell("M", 500, 0.45, 6.0, 2108.0, 3.0, 6.0, 3.8, 0.8, "franca", "sano", 0.85),
    ReferenceCell("M", 4500, 0.25, 6.1, 2112.0, 8.0, 5.0, 3.5, 0.9, "arenosa",
                  "estres hidrico", 0.45),
    ReferenceCell("Z", 2000, 0.70, 6.5, 2100.0, 1.0, 80.0, 5.0, 1.0, "franco-arenosa", "sano", 5.2),
    ReferenceCell("Z", 8000, 0.68, 6.4, 2101.0, 1.0, 60.0, 4.8, 1.0, "franco-arenosa",
                  "dano foliar", 3.5),
    ReferenceCell("R", 1000, 0.60, 6.8, 2104.0, 2.0, 45.0, 4.0, 1.1, "franca", "sano", 3.1),
    ReferenceCell("R", 9500, 0.90, 6.6, None, None, None, None, None, None, "ahogada", None),
)


# =============================================================================
# PARAMETROS DE GENERACION. TODOS SON SUPUESTOS SINTETICOS.
#
# Ninguno es una constante agronomica medida. Se eligieron para que el campo
# reproduzca las ocho celdas de referencia y produzca pendientes cultivables,
# y se documentan uno a uno para que nadie los lea como agronomia.
# =============================================================================

#: Base radial del ajuste, en dos escalas.
#:
#: La ancha (40 m sobre una malla de 5x5) da la forma general; la estrecha
#: (20 m, una por anclaje) da el margen local para acercarse a la pendiente
#: declarada sin deformar el resto. Con una sola escala el error de pendiente se
#: quedaba en 3,2 puntos; con las dos baja a 2,8.
RBF_WIDE_SIGMA_M = 40.0
RBF_WIDE_GRID = 5
RBF_LOCAL_SIGMA_M = 20.0

#: Pesos del ajuste conjunto. Son la unica forma de decir "cuanto vale un metro
#: de cota frente a un punto de pendiente", y estan calibrados de modo que un
#: error de 0,1 m de cota pese lo mismo que 0,003 de tangente.
FIT_ELEVATION_WEIGHT = 10.0
FIT_SLOPE_WEIGHT = 300.0

#: Peso de la energia de flexion. Es lo que impide que el ajuste cumpla los
#: anclajes ondulando el terreno entre ellos: sin este termino la finca salia
#: con 36 % de pendiente maxima cumpliendo los catorce numeros.
FIT_BENDING_WEIGHT = 3.0e3

#: Iteraciones de Gauss-Newton y umbral de parada.
FIT_MAX_ITERATIONS = 100
FIT_TOLERANCE = 1e-11

#: Ruido de elevacion: amplitud en metros y resolucion de la retícula gruesa.
#: 0,10 m con lattice 3 (longitud de onda ~73 m). Se bajo de 0,24 m porque el
#: ruido tambien produce pendiente --unos 0,24*pi/55 = 1,4 %-- y a ese nivel
#: contaminaba los anclajes declarados al 1 %. Ahora aporta ~0,4 %.
ELEVATION_NOISE_M = 0.10
ELEVATION_NOISE_LATTICE = 3

#: Hondonada cerrada de remolacha. Es el unico rasgo del terreno que NO sale de
#: una cota declarada: R-09500 llega sin cota y con humedad 0,90, asi que la
#: profundidad se elige para producir ese encharcamiento.
FLOOD_HOLLOW_DEPTH_M = 1.6
FLOOD_HOLLOW_SIGMA_M = 22.0

#: Radios del filtro que mide la depresion local, en metros.
#:
#: La depresion es "cuanto mas bajo esta este punto que su entorno", y medirla
#: como `suavizado - elevacion` a secas NO funciona sobre un terreno inclinado:
#: la pendiente regional domina y cerca de los bordes invierte el signo. Medido:
#: R-09500, que es el fondo de la hondonada, salia con depresion NEGATIVA --una
#: loma-- porque esta en la esquina alta de la finca.
#:
#: Asi que primero se quita la tendencia regional (radio grande) y despues se
#: mide la depresion sobre el residuo (radio pequeno). Es un filtro de paso de
#: banda, y su resultado es invariante a cualquier inclinacion del terreno, que
#: es lo que hace falta para que "hondonada" signifique lo mismo en los cuatro
#: lotes.
DEPRESSION_BLUR_M = 25.0
DEPRESSION_TREND_M = 90.0

#: Humedad = base del lote + k_dep * depresion - k_slope * pendiente_norm.
#:
#: Ninguno de los dos se ajusta libremente. `k_slope` se fijo a mano porque el
#: ajuste libre le daba signo POSITIVO --mas pendiente, mas humedad--, que es
#: hidrologicamente al reves. `k_dep` sale de la pareja de celdas de referencia
#: de papa, que es la unica con las dos declaradas en el mismo lote y sin evento
#: de por medio en la que domina: 1,32 m de diferencia de depresion para 0,13 de
#: humedad. La forma la manda la fisica; solo la escala se toma de los datos.
HUMIDITY_K_DEPRESSION = 0.10
HUMIDITY_K_SLOPE = 0.12
HUMIDITY_NOISE = 0.035
HUMIDITY_NOISE_LATTICE = 5

#: Que celdas de referencia fijan la LINEA BASE de humedad de cada lote.
#:
#: Solo las declaradas SANAS, y la razon es de modelo, no de conveniencia: la
#: humedad de una celda afectada describe su estado DURANTE su evento, no el del
#: terreno. R-09500 llega con 0,90 y la etiqueta "ahogada" --es una lectura de
#: la inundacion del 2 de julio, no la humedad de fondo del lote--. Anclar la
#: base a ella exigiria excavar un crater de varios metros para que la
#: topografia sola explicara ese 0,90.
#:
#: Con las sanas la base queda EXACTA en los cuatro lotes, y las afectadas
#: quedan donde el terreno las pone: por encima o por debajo de la base segun
#: corresponda, y el resto de la diferencia lo explica el evento.
HUMIDITY_BASELINE_CONDITION = "sano"

#: Pendiente a la que se aplica la penalizacion maxima. El mismo valor que
#: `prediction.features.SLOPE_REFERENCE_DEG`, a proposito: si el generador y el
#: motor normalizaran la pendiente distinto, la comparacion no significaria nada.
SLOPE_REFERENCE_DEG = 15.0


@dataclass(frozen=True, slots=True)
class SoilProfile:
    """Como se construye `soil_quality`. SUPUESTOS SINTETICOS."""

    #: Punto de partida antes de aplicar nada.
    base: float = 0.62
    #: La materia organica se acumula donde hay humedad y no hay arrastre.
    humidity_gain: float = 0.22
    #: La pendiente lava el suelo: erosion y perdida de finos.
    slope_penalty: float = 0.30
    #: El encharcamiento permanente degrada la estructura.
    waterlog_penalty: float = 0.25
    #: Umbral de humedad a partir del cual se considera encharcamiento.
    waterlog_threshold: float = 0.80
    #: Cuanto castiga alejarse del pH optimo del cultivo, por unidad de pH.
    ph_penalty_per_unit: float = 0.10
    noise: float = 0.06
    noise_lattice: int = 5


@dataclass(frozen=True, slots=True)
class HealthProfile:
    """Como se construye `health_factor` en t0. SUPUESTOS SINTETICOS.

    La respuesta a la humedad es una CAMPANA y no una recta: por debajo del
    optimo el cultivo sufre sequia y por encima asfixia radicular. Es lo que
    hace que el maiz seco del este y la remolacha encharcada del noreste sufran
    por causas opuestas en vez de por el mismo gradiente.
    """

    #: Sanidad en el optimo de humedad y sin pendiente.
    ceiling: float = 0.94
    #: Anchura de la campana. 0,18 deja caer la sanidad ~30 % a 0,25 del optimo.
    humidity_sigma: float = 0.18
    #: Cuanta sanidad se lleva la pendiente de referencia.
    slope_penalty: float = 0.14
    noise: float = 0.05
    noise_lattice: int = 6
    floor: float = 0.10


@dataclass(frozen=True, slots=True)
class DensityProfile:
    """Como se construye `plant_density`. SUPUESTOS SINTETICOS.

    Se siembra igual en todo el lote; lo que cambia es cuanta planta prende.
    La emergencia cae en pendiente --arrastre de semilla-- y en encharcamiento.
    """

    #: Fraccion de la densidad objetivo que se pierde en la pendiente maxima.
    slope_penalty: float = 0.18
    #: Fraccion que se pierde por alejarse del optimo de humedad del cultivo.
    humidity_penalty: float = 0.45
    noise: float = 0.05
    noise_lattice: int = 7
    #: Suelo relativo: ni la peor celda queda sin plantas.
    floor_ratio: float = 0.45
    ceiling_ratio: float = 1.05


@dataclass(frozen=True, slots=True)
class ResidualProfile:
    """`base_yield_factor`: lo que ninguna otra variable explica.

    Se guarda en `grid_cells`, asi que CERES SI lo ve. No confundir con el
    residuo de la verdad, que es otro campo y no se guarda.
    """

    spread: float = 0.10
    noise_lattice: int = 8
    floor: float = 0.82
    ceiling: float = 1.18


SOIL = SoilProfile()
HEALTH = HealthProfile()
DENSITY = DensityProfile()
RESIDUAL = ResidualProfile()


# =============================================================================
# UTILIDADES DE CAMPO
# =============================================================================


def cell_index_to_local(index: int) -> tuple[int, int]:
    """`cell_code` -> (x, y) dentro del lote. Misma convencion que `field.py`."""
    return (index - 1) % PLOT_CELLS, (index - 1) // PLOT_CELLS


def local_to_farm(plot_code: str, x: int, y: int) -> tuple[int, int]:
    """(x, y) del lote -> (x, y) de la malla de finca."""
    ox, oy = PLOT_ORIGIN[plot_code]
    return ox + x, oy + y


def gaussian_blur(field: np.ndarray, sigma_m: float) -> np.ndarray:
    """Suavizado gaussiano separable, en numpy puro.

    No se usa `scipy.ndimage` porque scipy no es dependencia del proyecto y
    anadirla por una convolucion seria pagar mucho por poco.
    """
    radius = int(3 * sigma_m)
    kernel = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma_m) ** 2)
    kernel /= kernel.sum()
    padded = np.pad(field, radius, mode="edge")
    horizontal = np.apply_along_axis(lambda row: np.convolve(row, kernel, "valid"), 1, padded)
    return np.apply_along_axis(lambda col: np.convolve(col, kernel, "valid"), 0, horizontal)


def constrained_anchors() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Los siete anclajes con cota Y pendiente declaradas.

    R-09500 no entra: el escenario la da sin cota ni pendiente. Su hondonada se
    estampa DESPUES del ajuste, que es la unica forma de que sobreviva --ver
    `build_farm_surface`--.
    """
    puntos, cotas, pendientes = [], [], []
    for ref in REFERENCE_CELLS:
        if ref.elevation_m is None or ref.slope_pct is None:
            continue
        x, y = local_to_farm(ref.plot_code, *cell_index_to_local(ref.index))
        puntos.append((float(x), float(y)))
        cotas.append(ref.elevation_m)
        pendientes.append(ref.slope_pct / 100.0)
    return np.array(puntos), np.array(cotas), np.array(pendientes)


def _basis_fields(centers: np.ndarray, sigmas: np.ndarray, xs, ys) -> np.ndarray:
    """Plano (1, x, y) mas una gaussiana por centro."""
    campos = [np.ones_like(xs), xs, ys]
    for (cx, cy), sigma in zip(centers, sigmas, strict=True):
        campos.append(np.exp(-(((xs - cx) ** 2 + (ys - cy) ** 2) / (2.0 * sigma**2))))
    return np.array(campos)


def _bending_energy(gx: np.ndarray, gy: np.ndarray) -> np.ndarray:
    """Las tres segundas derivadas que componen la energia de flexion.

    `zxx^2 + 2*zxy^2 + zyy^2`, escrito como un vector cuya norma al cuadrado es
    esa energia, para poder acumularlo como un termino cuadratico mas.
    """
    zxy, zxx = np.gradient(gx, CELL_SIZE_M, CELL_SIZE_M)
    zyy, _ = np.gradient(gy, CELL_SIZE_M, CELL_SIZE_M)
    return np.stack([zxx, np.sqrt(2.0) * zxy, zyy])


@dataclass(frozen=True, slots=True)
class FarmSurface:
    """La superficie compartida por los cuatro lotes, en malla de finca."""

    elevation_m: np.ndarray
    slope_deg: np.ndarray
    #: `suavizado - elevacion`: positiva en hondonadas, negativa en lomas.
    depression_m: np.ndarray

    def plot_slice(self, plot_code: str) -> tuple[slice, slice]:
        ox, oy = PLOT_ORIGIN[plot_code]
        return slice(oy, oy + PLOT_CELLS), slice(ox, ox + PLOT_CELLS)


@lru_cache(maxsize=4)
def build_farm_surface(seed: int = MASTER_SEED) -> FarmSurface:
    """La topografia de la finca, ajustada a cotas Y pendientes declaradas.

    Funcion pura: misma semilla -> mismos arrays, bit a bit. Se cachea porque el
    ajuste cuesta bastante mas que evaluar una formula y el resultado no depende
    de nada mas que de la semilla; los arrays que devuelve no los muta nadie.

    EL AJUSTE, en tres terminos:

        min  wz * ||z(anclas) - cotas||^2
           + ws * ||  |grad z|(anclas) - pendientes ||^2
           + wc * (energia de flexion sobre toda la finca)

    Los dos primeros son las restricciones del escenario. El tercero es el que
    decide entre las infinitas superficies que las cumplen, y sin el la solucion
    es una finca ondulada al 36 %. La norma del gradiente no es lineal en los
    pesos, asi que se resuelve con Gauss-Newton; los otros dos terminos si lo
    son y entran cerrados.

    El gradiente se calcula con el MISMO `numpy.gradient` que produce
    `slope_deg` aguas abajo. No es un detalle: si el ajuste usara derivadas
    analiticas y la pendiente saliera de diferencias finitas, se estaria
    ajustando una cosa y sirviendo otra.
    """
    xs = np.arange(FARM_SPAN)[None, :] * np.ones((FARM_SPAN, 1))
    ys = np.arange(FARM_SPAN)[:, None] * np.ones((1, FARM_SPAN))

    anclas, cotas, pendientes = constrained_anchors()

    # Centros en dos escalas: malla ancha para la forma, uno estrecho por ancla
    # para el margen local.
    centros = [
        (cx, cy)
        for cx in np.linspace(10.0, FARM_SPAN - 10.0, RBF_WIDE_GRID)
        for cy in np.linspace(10.0, FARM_SPAN - 10.0, RBF_WIDE_GRID)
    ]
    sigmas = [RBF_WIDE_SIGMA_M] * len(centros)
    centros += [tuple(p) for p in anclas]
    sigmas += [RBF_LOCAL_SIGMA_M] * len(anclas)
    base = _basis_fields(np.array(centros), np.array(sigmas), xs, ys)
    n_base = len(base)

    # --- Termino FIJO: entra en los residuos y el ajuste lo compensa ---------
    # Solo el ruido. Un unico stream para TODA la finca: es lo que garantiza
    # que los bordes entre lotes vecinos casen.
    stream = np.random.SeedSequence(seed).spawn(1)[0]
    fijo = ELEVATION_NOISE_M * smooth_noise(
        np.random.default_rng(stream), FARM_SPAN, FARM_SPAN, lattice=ELEVATION_NOISE_LATTICE
    )

    gradientes = [np.gradient(campo, CELL_SIZE_M, CELL_SIZE_M) for campo in base]
    gx_base = np.array([g[1] for g in gradientes])
    gy_base = np.array([g[0] for g in gradientes])
    gy_fijo, gx_fijo = np.gradient(fijo, CELL_SIZE_M, CELL_SIZE_M)

    # Energia de flexion como forma cuadratica en los pesos.
    flexion = np.array(
        [_bending_energy(gx_base[k], gy_base[k]).ravel() for k in range(n_base)]
    )
    flexion_fija = _bending_energy(gx_fijo, gy_fijo).ravel()
    hessiano_flexion = flexion @ flexion.T
    gradiente_flexion = flexion @ flexion_fija

    filas = [int(p[1]) for p in anclas]
    columnas = [int(p[0]) for p in anclas]
    valor_p = np.array([[base[k][y, x] for y, x in zip(filas, columnas, strict=True)]
                        for k in range(n_base)])
    gx_p = np.array([[gx_base[k][y, x] for y, x in zip(filas, columnas, strict=True)]
                     for k in range(n_base)])
    gy_p = np.array([[gy_base[k][y, x] for y, x in zip(filas, columnas, strict=True)]
                     for k in range(n_base)])
    fijo_p = np.array([fijo[y, x] for y, x in zip(filas, columnas, strict=True)])
    gx_fijo_p = np.array([gx_fijo[y, x] for y, x in zip(filas, columnas, strict=True)])
    gy_fijo_p = np.array([gy_fijo[y, x] for y, x in zip(filas, columnas, strict=True)])

    # Arranque: el plano de minimos cuadrados sobre las cotas. Da igual cual sea
    # --Gauss-Newton converge desde cualquier sitio razonable-- pero partir del
    # plano ahorra iteraciones y hace el resultado mas facil de seguir.
    pesos = np.zeros(n_base)
    plano = np.column_stack([np.ones(len(anclas)), anclas[:, 0], anclas[:, 1]])
    pesos[:3], *_ = np.linalg.lstsq(plano, cotas, rcond=None)

    for _ in range(FIT_MAX_ITERATIONS):
        z_p = valor_p.T @ pesos + fijo_p
        dx_p = gx_p.T @ pesos + gx_fijo_p
        dy_p = gy_p.T @ pesos + gy_fijo_p
        magnitud = np.sqrt(dx_p**2 + dy_p**2) + 1e-12

        residuo = np.concatenate(
            [
                FIT_ELEVATION_WEIGHT * (z_p - cotas),
                FIT_SLOPE_WEIGHT * (magnitud - pendientes),
            ]
        )
        jacobiano = np.vstack(
            [
                FIT_ELEVATION_WEIGHT * valor_p.T,
                FIT_SLOPE_WEIGHT
                * ((dx_p[:, None] * gx_p.T + dy_p[:, None] * gy_p.T) / magnitud[:, None]),
            ]
        )
        # 1e-9 solo evita que el sistema sea singular si dos centros coincidieran.
        izquierda = (
            jacobiano.T @ jacobiano
            + FIT_BENDING_WEIGHT * hessiano_flexion
            + 1e-9 * np.eye(n_base)
        )
        derecha = jacobiano.T @ residuo + FIT_BENDING_WEIGHT * (
            hessiano_flexion @ pesos + gradiente_flexion
        )
        paso = np.linalg.solve(izquierda, derecha)
        pesos = pesos - paso
        if np.abs(paso).max() < FIT_TOLERANCE:
            break

    elevacion = np.tensordot(pesos, base, axes=1) + fijo

    # --- La hondonada de inundacion, DESPUES del ajuste ----------------------
    # Es el unico rasgo del terreno sin cota ni pendiente declaradas: R-09500
    # llega con humedad 0,90 y nada mas, asi que la profundidad la elegimos.
    #
    # Y va DESPUES porque dentro del ajuste desaparecia. Hay un centro de base
    # radial justo en ese punto --es uno de los anclajes-- y el termino de
    # flexion, que premia superficies lisas, lo usaba para rellenarla. Medido:
    # la celda quedaba 0,15 m POR ENCIMA de la media de su anillo a 22 m, o sea
    # una loma, y la celda declarada "ahogada" acababa menos humeda que la sana
    # del mismo lote.
    #
    # Estamparla despues no estropea el ajuste: el anclaje mas cercano, R-01000,
    # esta a 85 m, y a esa distancia una gaussiana de sigma 22 vale e^-7,5.
    fx, fy = local_to_farm("R", *cell_index_to_local(9500))
    elevacion = elevacion - FLOOD_HOLLOW_DEPTH_M * np.exp(
        -(((xs - fx) ** 2 + (ys - fy) ** 2) / (2.0 * FLOOD_HOLLOW_SIGMA_M**2))
    )

    grad_y, grad_x = np.gradient(elevacion, CELL_SIZE_M, CELL_SIZE_M)
    pendiente = np.clip(np.degrees(np.arctan(np.hypot(grad_x, grad_y))), 0.0, 90.0)
    # Paso de banda: quitar la tendencia regional y medir sobre el residuo.
    detendida = elevacion - gaussian_blur(elevacion, DEPRESSION_TREND_M)
    depresion = gaussian_blur(detendida, DEPRESSION_BLUR_M) - detendida

    return FarmSurface(elevation_m=elevacion, slope_deg=pendiente, depression_m=depresion)


@lru_cache(maxsize=4)
def humidity_plot_bases(seed: int = MASTER_SEED) -> dict[str, float]:
    """La linea base de humedad de cada lote, resuelta de sus celdas sanas.

    No es una tabla de numeros magicos: se despeja de la celda de referencia
    sana del lote una vez fijada la parte topografica.

        base = humedad_declarada - (k_dep * depresion - k_slope * pendiente_norm)

    Recoge lo que la topografia no explica --el regimen de riego del lote
    (zanahoria lleva riego semanal, maiz uno puntual) y su textura dominante--
    y por construccion hace que la celda sana de cada lote salga EXACTA.

    Que se calcule en vez de escribirse tiene una consecuencia util: si alguien
    toca la topografia, las bases se recolocan solas y las celdas sanas siguen
    cuadrando. Escritas a mano, se quedarian describiendo el terreno anterior.
    """
    superficie = build_farm_surface(seed)
    bases: dict[str, float] = {}
    for ref in REFERENCE_CELLS:
        if ref.condition != HUMIDITY_BASELINE_CONDITION:
            continue
        x, y = local_to_farm(ref.plot_code, *cell_index_to_local(ref.index))
        pendiente_norm = min(superficie.slope_deg[y, x] / SLOPE_REFERENCE_DEG, 1.0)
        topografia = (
            HUMIDITY_K_DEPRESSION * superficie.depression_m[y, x]
            - HUMIDITY_K_SLOPE * pendiente_norm
        )
        bases[ref.plot_code] = float(ref.humidity - topografia)

    faltan = set(PLOT_ORDER) - set(bases)
    if faltan:
        raise ValueError(f"lotes sin celda de referencia sana: {sorted(faltan)}")
    return bases


@dataclass(frozen=True, slots=True)
class PlotField:
    """Las variables de las 10.000 celdas de un lote, como arrays `[y, x]`.

    `humidity` es LATENTE: viaja aqui porque el generador la necesita, pero no
    llega a ninguna fila de `grid_cells`.
    """

    plot_code: str
    elevation_m: np.ndarray
    slope_deg: np.ndarray
    soil_quality: np.ndarray
    plant_density: np.ndarray
    health_factor: np.ndarray
    base_yield_factor: np.ndarray
    humidity: np.ndarray
    depression_m: np.ndarray


def _plot_streams(seed: int, plot_code: str, count: int) -> list[np.random.Generator]:
    """Streams independientes por (lote, variable).

    Se derivan de `(seed, indice del lote)` y se reparten por POSICION, asi que
    anadir una variable nueva al final no desplaza los valores de las que ya
    existian. Es la propiedad que hace que el dataset siga siendo reproducible
    despues de tocar el generador.
    """
    plot_index = PLOT_ORDER.index(plot_code)
    raiz = np.random.SeedSequence([seed, plot_index])
    return [np.random.default_rng(s) for s in raiz.spawn(count)]


def build_plot_field(
    surface: FarmSurface,
    plot_code: str,
    seed: int = MASTER_SEED,
) -> PlotField:
    """Recorta el lote de la superficie de finca y deriva sus variables."""
    escenario = SCENARIO_BY_CODE[plot_code]
    filas, columnas = surface.plot_slice(plot_code)

    elevacion = surface.elevation_m[filas, columnas]
    pendiente = surface.slope_deg[filas, columnas]
    depresion = surface.depression_m[filas, columnas]
    pendiente_norm = np.clip(pendiente / SLOPE_REFERENCE_DEG, 0.0, 1.0)

    rng_hum, rng_suelo, rng_salud, rng_dens, rng_resid = _plot_streams(seed, plot_code, 5)

    # --- Humedad: topografia + regimen hidrico del lote ----------------------
    humedad = (
        humidity_plot_bases(seed)[plot_code]
        + HUMIDITY_K_DEPRESSION * depresion
        - HUMIDITY_K_SLOPE * pendiente_norm
        + HUMIDITY_NOISE
        * smooth_noise(rng_hum, PLOT_CELLS, PLOT_CELLS, lattice=HUMIDITY_NOISE_LATTICE)
    )
    humedad = np.clip(humedad, 0.05, 0.98)

    # --- Suelo: materia organica donde hay agua, erosion donde hay pendiente --
    encharcamiento = np.clip(humedad - SOIL.waterlog_threshold, 0.0, None) / (
        1.0 - SOIL.waterlog_threshold
    )
    desvio_ph = abs(escenario.ph - 6.5)
    suelo = (
        SOIL.base
        + SOIL.humidity_gain * humedad
        - SOIL.slope_penalty * pendiente_norm
        - SOIL.waterlog_penalty * encharcamiento
        - SOIL.ph_penalty_per_unit * desvio_ph
        + SOIL.noise * smooth_noise(rng_suelo, PLOT_CELLS, PLOT_CELLS, lattice=SOIL.noise_lattice)
    )
    suelo = np.clip(suelo, 0.05, 0.98)

    # --- Sanidad t0: campana alrededor del optimo de humedad del cultivo -----
    # ESTADO ANTERIOR A LOS EVENTOS. Los eventos NO entran aqui: entran como
    # observaciones fechadas, y `state_at` los aplica a partir de su fecha. Si
    # se hornearan aqui, el eje temporal no existiria.
    desajuste = (humedad - escenario.ideal_humidity) / HEALTH.humidity_sigma
    salud = (
        HEALTH.ceiling * np.exp(-0.5 * desajuste**2)
        - HEALTH.slope_penalty * pendiente_norm
        + HEALTH.noise * smooth_noise(rng_salud, PLOT_CELLS, PLOT_CELLS, lattice=HEALTH.noise_lattice)
    )
    salud = np.clip(salud, HEALTH.floor, 1.0)

    # --- Densidad: cuanta planta prende --------------------------------------
    desajuste_abs = np.abs(humedad - escenario.ideal_humidity)
    ratio = (
        1.0
        - DENSITY.slope_penalty * pendiente_norm
        - DENSITY.humidity_penalty * desajuste_abs
        + DENSITY.noise * smooth_noise(rng_dens, PLOT_CELLS, PLOT_CELLS, lattice=DENSITY.noise_lattice)
    )
    ratio = np.clip(ratio, DENSITY.floor_ratio, DENSITY.ceiling_ratio)
    densidad = escenario.optimal_density_per_m2 * ratio

    # --- Residuo local que el modelo SI ve -----------------------------------
    residual = np.clip(
        1.0
        + RESIDUAL.spread
        * smooth_noise(rng_resid, PLOT_CELLS, PLOT_CELLS, lattice=RESIDUAL.noise_lattice),
        RESIDUAL.floor,
        RESIDUAL.ceiling,
    )

    return PlotField(
        plot_code=plot_code,
        elevation_m=elevacion,
        slope_deg=pendiente,
        soil_quality=suelo,
        plant_density=densidad,
        health_factor=salud,
        base_yield_factor=residual,
        humidity=humedad,
        depression_m=depresion,
    )


def build_all_fields(seed: int = MASTER_SEED) -> dict[str, PlotField]:
    """Los cuatro lotes, recortados de la MISMA superficie."""
    superficie = build_farm_surface(seed)
    return {code: build_plot_field(superficie, code, seed) for code in PLOT_ORDER}


def plot_origin_latlon(plot_code: str) -> tuple[float, float]:
    """Esquina suroeste del lote, en grados.

    La finca esta centrada en el punto declarado, asi que la esquina suroeste de
    la malla de finca queda a media diagonal al suroeste.
    """
    metros_por_grado_lon = METERS_PER_DEGREE_LATITUDE * math.cos(math.radians(FARM_LATITUDE))
    sur_oeste_lat = FARM_LATITUDE - (FARM_SPAN / 2.0) / METERS_PER_DEGREE_LATITUDE
    sur_oeste_lon = FARM_LONGITUDE - (FARM_SPAN / 2.0) / metros_por_grado_lon

    ox, oy = PLOT_ORIGIN[plot_code]
    latitud = sur_oeste_lat + (oy * CELL_SIZE_M) / METERS_PER_DEGREE_LATITUDE
    longitud = sur_oeste_lon + (ox * CELL_SIZE_M) / metros_por_grado_lon
    return latitud, longitud


def cell_centroid(plot_code: str, x: int, y: int) -> tuple[float, float]:
    """Centroide geografico de una celda del lote."""
    origen_lat, origen_lon = plot_origin_latlon(plot_code)
    latitud = origen_lat + ((y + 0.5) * CELL_SIZE_M) / METERS_PER_DEGREE_LATITUDE
    metros_por_grado_lon = METERS_PER_DEGREE_LATITUDE * math.cos(math.radians(latitud))
    longitud = origen_lon + ((x + 0.5) * CELL_SIZE_M) / metros_por_grado_lon
    return latitud, longitud


def build_cell_code(plot_code: str, x: int, y: int) -> str:
    """`P-00001` para (0, 0). Prefijos P/M/Z/R, distintos de la finca demo.

    No es cosmetico: `tests/postgres/conftest.py` busca `cell_code = 'A-00240'`
    sin filtrar por lote, asi que reutilizar el prefijo `A` devolveria dos filas
    y romperia los tests de paridad de la finca demo.
    """
    return f"{plot_code}-{y * PLOT_CELLS + x + 1:05d}"
