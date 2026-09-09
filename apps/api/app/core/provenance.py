"""De donde salen los datos que sirve esta instalacion de CERES.

QUE ES ESTE MODULO Y QUE NO ES
------------------------------
Es la declaracion de una PROPIEDAD DEL DESPLIEGUE, no de cada fila. La base de
datos no guarda en ninguna parte que sus celdas las escribio un generador: no
hay columna, no hay tabla `data_sources`, no hay nada. Lo unico que existe es el
hecho de que el dataset se sembro con `app.core.synthetic`, y ese hecho ya se
afirmaba en un sitio —el `disclaimer` de `/health`— en forma de frase para
leer.

Lo que hace este modulo es convertir esa misma afirmacion en algo que un cliente
pueda usar sin interpretar prosa. No es informacion nueva ni inventada: es la
que ya se estaba dando, expresada con el vocabulario cerrado de `Provenance`.

LIMITE HONESTO, y conviene tenerlo escrito
------------------------------------------
Si alguien cargara mediciones reales en esta misma base de datos, la API
seguiria diciendo `synthetic`, porque la afirmacion es del despliegue y no de la
fila. Eso NO es un descuido: es exactamente hasta donde llega lo que el sistema
puede respaldar hoy, y por eso `DISCLAIMER` y `DATASET_KIND` viven juntos y se
leen de aqui.

El dia que exista una tabla de fuentes, este modulo se sustituye por una
consulta y el contrato de la API no cambia ni una letra.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from app.core.synthetic import cuadricula
from app.domain.enums import Provenance

#: Recordatorio permanente en el contrato, no solo en la documentacion.
#: Lo sirve `/health` y es la version en prosa de `DATASET_KIND`.
DISCLAIMER = (
    "DEMO / SYNTHETIC DATA. El motor de prediccion es un modelo experimental y "
    "demostrativo sobre datos sinteticos, no una prediccion agronomica "
    "cientificamente validada."
)

#: La procedencia que este despliegue puede respaldar para sus datos de celda.
DATASET_KIND: Provenance = Provenance.SYNTHETIC

#: Modulo que genero el dataset. Se nombra para que la afirmacion sea
#: verificable: quien dude puede ir a leerlo.
DATASET_GENERATOR = "app.core.synthetic.field"

#: Como se construye la elevacion sintetica. Descripcion del METODO, no de su
#: calidad: quien lo lea sabe que no hay un levantamiento detras.
ELEVATION_METHOD = (
    "gradiente sur-norte + ruido de reticula suavizado + hondonada gaussiana"
)

#: Como se deriva la pendiente. Es la unica magnitud de la respuesta que se
#: calcula a partir de otra de la misma respuesta.
SLOPE_METHOD = "numpy.gradient sobre elevation_m"

SLOPE_DERIVED_FROM = ("elevation_m",)

#: Campos agronomicos que salen del generador, en el orden en que los produce.
AGRONOMIC_FIELDS = (
    "soil_quality",
    "plant_density",
    "health_factor",
    "base_yield_factor",
)

AGRONOMIC_METHOD = (
    "gradientes este-oeste + ruido de reticula suavizado + foco de estres localizado"
)

#: RESOLUCION EFECTIVA de la elevacion sintetica, en metros.
#:
#: NO es una estimacion a ojo ni un numero copiado de un comentario: sale de
#: descomponer el campo generado en valores singulares. Cuatro componentes
#: reconstruyen mas del 99,9 % de la elevacion de un lote de 20 m de lado, asi
#: que el campo tiene del orden de cuatro grados de libertad y su detalle real
#: ocurre a unos 20/4 = 5 m. Subdividir por debajo interpola, no informa.
#:
#: `tests/unit/test_provenance.py` vuelve a medirlo sobre el campo generado: si
#: alguien cambia el generador y el campo gana o pierde estructura, el test se
#: cae y esta constante deja de poder afirmarse.
ELEVATION_EFFECTIVE_RESOLUTION_M = 5.0

#: Cuantos componentes principales deben bastar, y con que fraccion. Lo usan a
#: la vez la constante de arriba y el test que la comprueba.
ELEVATION_EFFECTIVE_RANK = 4
ELEVATION_EFFECTIVE_VARIANCE = 0.999

#: Referencia vertical de `elevation_m`.
#:
#: `unknown` a proposito. El generador produce "metros sobre el nivel del mar"
#: sin decir sobre que geoide o elipsoide, y la diferencia entre uno y otro es
#: de decenas de metros. Declarar cualquier datum aqui seria inventarlo.
ELEVATION_VERTICAL_DATUM = "unknown"

#: Esquina del lote a la que se refieren `origin_latitude` y `origin_longitude`.
#:
#: Lo decide `app.core.synthetic.field.cell_centroid`, que suma
#: `(y + 0.5) * cell_size_m` hacia el norte y `(x + 0.5) * cell_size_m` hacia el
#: este. Estaba escrito en la descripcion de un campo; ahora es un valor que un
#: cliente puede leer sin parsear texto.
ORIGIN_CORNER = "southwest"


# =============================================================================
# DOS GENERADORES EN EL MISMO DESPLIEGUE
#
# Hasta la finca sintetica La Cuadricula habia uno solo, y las constantes de
# arriba lo describian entero. Ahora hay dos, y no producen el mismo terreno:
#
#     app.core.synthetic.field       gradiente + hondonada gaussiana
#                                    detalle real a ~5 m sobre un lote de 20 m
#     app.core.synthetic.cuadricula  plano ajustado a cotas declaradas + base
#                                    radial. Con sigma de 55 m, el detalle real
#                                    esta a ~33-50 m sobre un lote de 100 m
#
# Servir 5 m para las celdas de La Cuadricula seria afirmar veinticinco veces
# mas detalle del que el campo tiene. Es exactamente la clase de afirmacion que
# este modulo existe para impedir, asi que la procedencia deja de ser una sola y
# pasa a elegirse por finca.
#
# SIGUE SIENDO UNA PROPIEDAD DE LA FUENTE, NO DE LA FILA. No hay columna que
# diga quien escribio cada celda; lo que hay es un `farm_id` conocido porque lo
# fija el generador. El dia que exista una tabla `data_sources`, este registro se
# sustituye por una consulta y el contrato de la API no cambia ni una letra.
# =============================================================================


@dataclass(frozen=True, slots=True)
class DatasetSource:
    """Lo que un despliegue puede respaldar sobre las celdas de una finca."""

    kind: Provenance
    generator: str
    elevation_method: str
    #: A que escala varia la elevacion DE VERDAD. Se mide sobre el campo
    #: generado; no se estima a ojo. Lo comprueba `tests/unit/test_provenance.py`.
    elevation_effective_resolution_m: float
    agronomic_method: str
    #: Que representa la malla, en una frase citable. Ver `DatasetProvenance`.
    representation: str


#: La finca demo. Es el defecto: cualquier finca que no se reconozca se describe
#: con las constantes historicas, que es lo unico que se podia afirmar antes.
DEMO_SOURCE = DatasetSource(
    kind=DATASET_KIND,
    generator=DATASET_GENERATOR,
    elevation_method=ELEVATION_METHOD,
    elevation_effective_resolution_m=ELEVATION_EFFECTIVE_RESOLUTION_M,
    agronomic_method=AGRONOMIC_METHOD,
    representation=(
        "Malla de 1 m2 por celda sobre un campo sintetico espacialmente "
        "correlacionado. La resolucion nominal es de 1 m; el detalle real del "
        f"campo esta a unos {ELEVATION_EFFECTIVE_RESOLUTION_M:.0f} m. No hay "
        "informacion medida de cada metro cuadrado."
    ),
)

#: Resolucion efectiva de la elevacion de La Cuadricula, en metros.
#:
#: Medida igual que la de la finca demo: descomponiendo el campo en valores
#: singulares. Tres componentes reconstruyen mas del 99,9 % de la elevacion de un
#: lote de 100 m de lado, o sea unos 100/3 = 33 m de detalle real. Se declara el
#: caso PEOR de los cuatro lotes (papa y remolacha dan rango 3; maiz y zanahoria,
#: rango 2, o sea 50 m), porque prometer el mejor seria prometer de mas.
CUADRICULA_ELEVATION_EFFECTIVE_RESOLUTION_M = 33.3
CUADRICULA_ELEVATION_EFFECTIVE_RANK = 3

CUADRICULA_SOURCE = DatasetSource(
    kind=Provenance.SYNTHETIC,
    generator="app.core.synthetic.cuadricula",
    elevation_method=(
        "plano de minimos cuadrados sobre 7 cotas declaradas + funciones de base "
        "radial que cierran los residuos + hondonada gaussiana + ruido de "
        "reticula suavizado"
    ),
    elevation_effective_resolution_m=CUADRICULA_ELEVATION_EFFECTIVE_RESOLUTION_M,
    agronomic_method=(
        "cadena topografia -> humedad latente -> suelo/sanidad/densidad, cada "
        "eslabon con su propio ruido de reticula suavizado"
    ),
    representation=(
        "Representamos la finca a resolucion de 1 m2 por celda utilizando un "
        "campo sintetico espacialmente correlacionado. Son 40.000 unidades de "
        "representacion, no 40.000 mediciones: la resolucion nominal es de 1 m "
        f"y el detalle real del campo esta a unos "
        f"{CUADRICULA_ELEVATION_EFFECTIVE_RESOLUTION_M:.0f} m. Cuando entren un "
        "DEM, sensores o imagenes, la malla no cambia; lo que sube es lo que "
        "hay debajo."
    ),
)

_SOURCES_BY_FARM: dict[uuid.UUID, DatasetSource] = {
    cuadricula.FARM_ID: CUADRICULA_SOURCE,
}


def source_for_farm(farm_id: uuid.UUID | None) -> DatasetSource:
    """Que puede afirmar este despliegue sobre las celdas de esa finca."""
    if farm_id is None:
        return DEMO_SOURCE
    return _SOURCES_BY_FARM.get(farm_id, DEMO_SOURCE)

