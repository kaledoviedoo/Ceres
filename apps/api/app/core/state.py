"""EL ESTADO DE UNA CELDA EN UNA FECHA.

    grid_cells  (dato base, nunca se toca)
        |
        +-- observations fechadas ---> state_at(t) ---> predict(t)

QUE HACE ESTE MODULO Y QUE NO
-----------------------------
Deriva. No persiste, no consulta la base de datos y no modifica nada. Recibe el
estado base de una celda, una lista de observaciones fechadas y un instante, y
devuelve un objeto nuevo con el estado que le corresponde a ese instante.

EL ESTADO BASE NO SE DESTRUYE. Es la diferencia entre tener historia y simular
que se tiene: si una observacion editara `grid_cells`, el estado anterior
desapareceria y la serie dejaria de ser reconstruible. Aqui `grid_cells` sigue
siendo lo que era el dia cero, y cualquier fecha se vuelve a derivar cuando haga
falta.

Consecuencia util: no hace falta guardar que observaciones se aplicaron a una
prediccion. Con `cell_id` y `as_of`, esta funcion las vuelve a encontrar y
produce exactamente el mismo estado. La derivacion es reproducible.

LA EVIDENCIA TIENE QUE SER AL MENOS TAN SOLIDA COMO EL DATASET
--------------------------------------------------------------
Una observacion mueve el estado solo si su procedencia esta a la altura de la
que el despliegue puede respaldar para sus celdas (`provenance.DATASET_KIND`).

LA TABLA COMPLETA, para que nadie tenga que deducirla:

    dataset      observacion   resultado    por que
    -----------  ------------  -----------  ------------------------------
    synthetic    synthetic     SI mueve     misma solidez
    synthetic    measured      SI mueve     la medicion es MEJOR evidencia
    measured     measured      SI mueve     misma solidez
    measured     synthetic     NO mueve     <-- LA LINEA QUE PROTEGE
    unknown      cualquiera    solo measured, el caso mas restrictivo

LA UNICA REGLA IRRENUNCIABLE es la cuarta: un dato que generamos nosotros no
puede mover una celda medida en campo. Todo lo demas se sigue de ella.

CUIDADO CON LEER LA SEGUNDA FILA AL REVES, que ya ha costado confusiones. Una
observacion MEDIDA sobre un dataset SINTETICO si cuenta, y tiene que contar: si
alguien sale al campo y mide una celda de la finca de prueba, eso es evidencia
mas fuerte que el dato generado, no mas debil. Bloquearla haria que una medicion
real valiera menos que una sintetica, que es exactamente al reves.

Y esa fila no relaja nada, porque la direccion peligrosa es la contraria. Lo que
hay que impedir es MEZCLAR HACIA ABAJO --meter sintetico donde hay medido--.
Meter medido donde hay sintetico solo mejora lo que se sabe.

La primera fila existe porque en un despliegue sintetico el estado base ya sale
de `app.core.synthetic`: rechazar ahi una observacion sintetica sobre una celda
sintetica no protegia de nada, solo impedia que el eje temporal existiera.

Pase lo que pase, `synthetic` se sigue sirviendo como `synthetic` en toda la
API. Esta regla decide QUE MUEVE EL ESTADO, nunca como se etiqueta un dato.

CUIDADO CON LA CIRCULARIDAD, que sigue siendo real
--------------------------------------------------
Las 24 observaciones de la finca demo son `synthetic` y su `severity` resulta
ser `health_factor` recodificado (correlacion -0,94): aplicarlas reconstruye una
circularidad —un dato derivado de la sanidad usado como prueba de que la sanidad
bajo—. Que ahora puedan mover el estado no las hace validas; hace que la
responsabilidad sea de QUIEN GENERA. La finca sintetica de
`app.core.synthetic.cuadricula` deriva la severidad del campo latente de humedad
y NO de `health_factor`, que es lo que la mantiene fuera de ese bucle.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Iterable

from app.core.provenance import DATASET_KIND
from app.domain.enums import ObservationType, Provenance

#: Version del modelo de impacto. Viaja en `Prediction.model_version` compuesta
#: con la del motor: dos predicciones calculadas con impactos distintos tienen
#: que ser distinguibles aunque la formula del riesgo no haya cambiado.
IMPACT_VERSION = "impact-v0"

# =============================================================================
# CONTRATO DE `impact-v0`
#
# Escrito aqui y no en un documento aparte porque es lo que hay que leer antes
# de creerse un numero que salga de este modulo.
#
# QUE ENTRA
#   * `type`      uno de los cinco tipos de observacion.
#   * `severity`  0..1, la gravedad DEL EVENTO declarada por quien observo.
#   * `observed_at`  cuando ocurrio en el campo.
#   * el estado base de la celda: `health_factor` y `soil_quality`.
#
# QUE SALE
#   * un `health_factor` y un `soil_quality` nuevos, siempre menores o iguales.
#   * NADA MAS. No toca elevacion, pendiente, densidad ni factor residual.
#
# QUE SUPUESTO REPRESENTA
#   Que un evento observado se lleva una FRACCION de la sanidad que quedaba,
#   proporcional a su gravedad, y que esa fraccion depende del tipo. Es una
#   forma funcional razonada —acotada, monotona, sin orden— con constantes
#   ELEGIDAS, no ajustadas.
#
# QUE NO PODEMOS AFIRMAR
#   * Que 0,45 sea la perdida real de una enfermedad grave. No hay con que
#     comprobarlo: `harvests` tiene 0 filas y no existen mediciones repetidas
#     de la misma celda antes y despues de un evento.
#   * Que la relacion sea lineal en la severidad.
#   * Que el efecto persista, se atenue o se recupere: aqui no se recupera
#     nunca, y eso es una limitacion del modelo, no una afirmacion sobre el
#     cultivo.
#   * Que dos eventos se compongan multiplicativamente en la realidad. Se
#     eligio asi porque es la unica composicion acotada e independiente del
#     orden, no porque se haya observado.
#
#   En una frase: `impact-v0` produce un estado DERIVED a partir de un dato
#   MEASURED bajo un supuesto no calibrado. No es una medicion y no es una
#   prediccion.
# =============================================================================

# --- El modelo de impacto ----------------------------------------------------
#
# ATENCION, Y ESTO NO ES UNA FORMALIDAD:
#
# Estos numeros NO ESTAN CALIBRADOS. No existe en CERES ningun dato que permita
# saber cuanto baja la sanidad de un cultivo una enfermedad de severidad 0,8:
# haria falta o bien cosechas reales contra las que ajustar (`harvests` tiene
# CERO filas), o bien mediciones agronomicas repetidas de la misma celda antes y
# despues del evento (no existen).
#
# Lo que si esta razonado es la ESTRUCTURA:
#
#   * que tipos tocan que campo. Una enfermedad y el estres hidrico afectan al
#     cultivo; el dano fisico ademas erosiona el suelo, que es la razon de que
#     toque las dos cosas.
#
#   * que `other` no toca NADA. "Anomalia pendiente de clasificar" significa
#     literalmente que no se sabe que se vio; convertir eso en una perdida de
#     sanidad seria inventar el diagnostico ademas de la magnitud.
#
#   * que el efecto sea proporcional a `severity` y acotado. Sin techo, dos
#     observaciones graves dejarian la sanidad en negativo.
#
# Se declaran igual que los pesos del riesgo —"SUPUESTO SINTETICO", el mismo
# estatus que `HEALTH_WEIGHT`— y se versionan para que cambiarlos sea visible.
# No deben leerse como agronomia.

#: Cuanto de la sanidad restante se lleva una observacion de severidad 1.
HEALTH_IMPACT: dict[ObservationType, float] = {
    ObservationType.DISEASE: 0.45,
    ObservationType.PEST: 0.35,
    ObservationType.WATER_STRESS: 0.30,
    ObservationType.PHYSICAL_DAMAGE: 0.25,
    ObservationType.OTHER: 0.0,
}

#: Lo mismo para el suelo. Solo el dano fisico lo toca: una plaga no erosiona.
SOIL_IMPACT: dict[ObservationType, float] = {
    ObservationType.PHYSICAL_DAMAGE: 0.10,
}

#: Suelo minimo tras aplicar impactos. El mismo recorte que usa el generador.
SOIL_FLOOR = 0.05
HEALTH_FLOOR = 0.05


@dataclass(frozen=True, slots=True)
class ObservedEvent:
    """Una observacion, reducida a lo que puede cambiar el estado.

    Es un DTO y no el modelo ORM a proposito: `state_at` no debe poder tocar la
    base de datos ni por accidente.
    """

    observed_at: datetime
    type: ObservationType
    severity: float
    #: Decide si la observacion mueve el estado, comparada con `DATASET_KIND`.
    #: Ver `admissible_provenances`.
    source_kind: Provenance


@dataclass(frozen=True, slots=True)
class DerivedCellState:
    """El estado de una celda en un instante.

    Cumple el protocolo `CellState` de `features.py`, asi que el motor lo acepta
    sin enterarse de que no es un `GridCell`. Esa es la razon de que esta fase no
    necesite tocar el motor: `predict()` ya aceptaba cualquier cosa con estos
    siete atributos.
    """

    cell_code: str
    elevation_m: float
    slope_deg: float
    soil_quality: float
    plant_density: float
    health_factor: float
    base_yield_factor: float

    #: De que momento habla este estado. `None` = el estado base, sin fechar.
    as_of: datetime | None = None
    #: Cuantas observaciones se aplicaron para llegar aqui. Cero significa que
    #: es el estado base tal cual, y es lo que ocurre hoy con todo el dataset.
    applied: int = 0


def base_state(cell: object) -> DerivedCellState:
    """El estado de la celda tal como esta en `grid_cells`, sin fechar."""
    return DerivedCellState(
        cell_code=cell.cell_code,  # type: ignore[attr-defined]
        elevation_m=cell.elevation_m,  # type: ignore[attr-defined]
        slope_deg=cell.slope_deg,  # type: ignore[attr-defined]
        soil_quality=cell.soil_quality,  # type: ignore[attr-defined]
        plant_density=cell.plant_density,  # type: ignore[attr-defined]
        health_factor=cell.health_factor,  # type: ignore[attr-defined]
        base_yield_factor=cell.base_yield_factor,  # type: ignore[attr-defined]
    )


def _utc(momento: datetime) -> datetime:
    """Un instante comparable, venga del driver que venga.

    Postgres devuelve `timestamptz` con zona; SQLite —el motor de los tests
    rapidos— devuelve el mismo dato SIN zona. Comparar los dos revienta con
    `can't compare offset-naive and offset-aware datetimes`, y el fallo no seria
    del test: cualquier despliegue sobre un driver que devuelva naive tendria el
    mismo problema en produccion.

    Se supone UTC para lo que llegue sin zona. Es lo unico que se puede suponer
    y es lo que el esquema declara: todas las columnas son `timestamptz`.
    """
    return momento if momento.tzinfo else momento.replace(tzinfo=timezone.utc)


#: Cuanto respalda cada procedencia, de mas a menos. Solo sirve para comparar
#: una observacion con el dataset sobre el que cae; no es un juicio de calidad.
_SOLIDEZ: dict[Provenance, int] = {
    Provenance.MEASURED: 4,
    Provenance.DERIVED: 3,
    Provenance.ESTIMATED: 2,
    Provenance.SYNTHETIC: 1,
    Provenance.UNKNOWN: 0,
}


def admissible_provenances(dataset_kind: Provenance) -> frozenset[Provenance]:
    """Que procedencias pueden mover el estado en un despliegue dado.

    La regla es una comparacion, no una lista blanca: una observacion entra si
    esta al menos tan respaldada como las celdas sobre las que cae.

        dataset `synthetic` -> {synthetic, estimated, derived, measured}
        dataset `measured`  -> {measured}

    `unknown` es el caso conservador y va aparte: un despliegue que no puede
    respaldar nada sobre sus celdas tampoco puede decidir a quien creer, asi que
    exige lo maximo. Sin esta excepcion, la comparacion lo dejaria admitirlo
    todo por ser el rango mas bajo, que es justo al reves de lo que toca.
    """
    if dataset_kind is Provenance.UNKNOWN:
        return frozenset({Provenance.MEASURED})
    minimo = _SOLIDEZ[dataset_kind]
    return frozenset(p for p, solidez in _SOLIDEZ.items() if solidez >= minimo and solidez > 0)


def applies(
    event: ObservedEvent,
    as_of: datetime,
    dataset_kind: Provenance = DATASET_KIND,
) -> bool:
    """Una observacion cuenta si esta respaldada y ya habia ocurrido.

    RESPALDADA: su procedencia esta a la altura de la del dataset. Ver
    `admissible_provenances` y la cabecera del modulo.

    YA OCURRIDA: el corte es `observed_at <= as_of`, no `created_at`. Lo que
    importa es cuando pasó en el campo, no cuando alguien lo tecleo: una
    observacion registrada hoy sobre algo visto en marzo pertenece a marzo.
    """
    if event.source_kind not in admissible_provenances(dataset_kind):
        return False
    return _utc(event.observed_at) <= _utc(as_of)


def state_at(
    cell: object,
    events: Iterable[ObservedEvent],
    as_of: datetime,
    dataset_kind: Provenance = DATASET_KIND,
) -> DerivedCellState:
    """El estado de `cell` en `as_of`, derivado de sus observaciones.

    EL ORDEN NO IMPORTA, LA INCLUSION SI. Los impactos se componen de forma
    multiplicativa sobre lo que queda —cada evento se lleva una fraccion del
    resto—, asi que aplicar A y luego B da lo mismo que B y luego A. Es
    deliberado: con observaciones fechadas el mismo dia, o con relojes que no
    coinciden, un resultado que dependiera del orden seria irreproducible.

    Lo que si cambia el resultado es CUANTAS entran, y eso lo decide la fecha.

    NO HAY RECUPERACION. Una observacion aplica desde su fecha en adelante y no
    se atenua con el tiempo. Un cultivo se recupera de un estres hidrico, y este
    modelo no lo sabe: modelarlo exigiria una curva de recuperacion que tampoco
    hay con que calibrar. Consecuencia honesta: la sanidad derivada solo puede
    bajar. Esta escrito aqui para que nadie lo descubra por sorpresa.
    """
    estado = base_state(cell)
    salud = estado.health_factor
    suelo = estado.soil_quality
    aplicadas = 0

    for event in events:
        if not applies(event, as_of, dataset_kind):
            continue
        aplicadas += 1
        severidad = min(1.0, max(0.0, event.severity))
        salud *= 1.0 - HEALTH_IMPACT.get(event.type, 0.0) * severidad
        suelo *= 1.0 - SOIL_IMPACT.get(event.type, 0.0) * severidad

    return replace(
        estado,
        health_factor=max(HEALTH_FLOOR, salud),
        soil_quality=max(SOIL_FLOOR, suelo),
        as_of=as_of,
        applied=aplicadas,
    )
