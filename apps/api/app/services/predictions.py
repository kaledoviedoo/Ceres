"""Servicio de predicciones: el puente entre HTTP y el motor.

    POST /api/v1/predictions {cell_id, crop_cycle_id}
            |
            v
    carga la celda y el ciclo desde la base de datos   <- el servidor es la fuente de verdad
            |
            v
    predict(cell, crop)                                <- motor puro, sin FastAPI
            |
            v
    INSERT en predictions                              <- fila nueva, nunca UPDATE

El cliente manda **solo identificadores**. Nunca puede enviar `soil_quality`,
`health_factor`, `slope`, `projected_yield` ni `risk_score`: esos valores se leen
de la base de datos y se calculan aqui. El schema `PredictionCreate` declara
`extra="forbid"`, asi que intentarlo devuelve 422.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.core.prediction import PredictionResult, predict
from app.core.state import IMPACT_VERSION, DerivedCellState, ObservedEvent, base_state, state_at
from app.domain.enums import ObservationType, Provenance
from app.models import CropCycle, GridCell, Observation, Plot, Prediction
from app.services.errors import ConflictError, NotFoundError
from app.services.farms import get_cell, get_plot


def _get_crop_cycle(session: Session, crop_cycle_id: uuid.UUID) -> CropCycle:
    """Ciclo con su cultivo cargado: el motor necesita los parametros del cultivo."""
    cycle = session.scalar(
        select(CropCycle)
        .where(CropCycle.id == crop_cycle_id)
        .options(joinedload(CropCycle.crop))
    )
    if cycle is None:
        raise NotFoundError("CropCycle", crop_cycle_id)
    return cycle


def _as_event(fila: Observation) -> ObservedEvent:
    """Una fila de `observations` reducida a lo que puede mover el estado.

    Se convierte a DTO antes de salir del servicio: `state_at` es una funcion
    pura y no debe poder tocar la sesion ni por accidente.
    """
    return ObservedEvent(
        observed_at=fila.observed_at,
        type=ObservationType(fila.type),
        severity=fila.severity,
        source_kind=Provenance(fila.source_kind),
    )


def observed_events(session: Session, cell_id: uuid.UUID) -> list[ObservedEvent]:
    """Las observaciones de una celda, como DTO."""
    filas = session.scalars(
        select(Observation).where(Observation.cell_id == cell_id)
    ).all()
    return [_as_event(fila) for fila in filas]


def cell_state_at(
    session: Session, cell: GridCell, as_of: datetime | None
) -> DerivedCellState:
    """El estado de la celda en `as_of`, o el base si no se pide fecha.

    NO ESCRIBE NADA. `grid_cells` sigue conteniendo el estado del dia cero, y
    cualquier fecha se vuelve a derivar cuando haga falta. Es lo que hace que la
    historia sea reconstruible en vez de simulada.
    """
    if as_of is None:
        return base_state(cell)
    return state_at(cell, observed_events(session, cell.id), as_of)


def run_engine(
    session: Session,
    cell: GridCell,
    cycle: CropCycle,
    as_of: datetime | None = None,
) -> PredictionResult:
    """Ejecuta el motor sobre el estado de una celda, sin persistir nada.

    Separado de `create_prediction` para poder previsualizar una prediccion sin
    escribir en la base de datos, y para que los tests puedan comprobar el
    calculo sin tocar la tabla.

    El motor no se entera de que recibe un estado derivado: `predict()` acepta
    cualquier cosa que cumpla el protocolo `CellState`, y `DerivedCellState` lo
    cumple. Por eso esta fase no toca el motor.
    """
    plot = session.get(Plot, cell.plot_id)
    area_m2 = plot.cell_size_m**2 if plot else 1.0
    return predict(cell_state_at(session, cell, as_of), cycle.crop, area_m2=area_m2)


def create_prediction(
    session: Session,
    cell_id: uuid.UUID,
    crop_cycle_id: uuid.UUID,
    as_of: datetime | None = None,
) -> Prediction:
    """Ejecuta el motor y persiste el resultado como una fila NUEVA.

    Nunca actualiza una prediccion existente: cada llamada es una fotografia
    historica mas. La base de datos lo refuerza con un trigger
    (`0002_prediction_immutability.sql`).
    """
    cell = get_cell(session, cell_id)
    cycle = _get_crop_cycle(session, crop_cycle_id)

    # Integridad espacial: no tiene sentido predecir una celda de Plot B bajo un
    # ciclo de cultivo que se siembra en Plot A.
    if cell.plot_id != cycle.plot_id:
        raise ConflictError(
            f"La celda {cell.cell_code} pertenece al lote {cell.plot_id}, "
            f"pero el ciclo {cycle.slug} se siembra en el lote {cycle.plot_id}"
        )

    # Sin fecha pedida, la prediccion habla de AHORA. Es lo mismo que hacia
    # antes de existir el eje temporal, con la diferencia de que ahora queda
    # dicho: `as_of` guarda de que momento habla, `created_at` cuando se corrio.
    momento = as_of or datetime.now(timezone.utc)
    result = run_engine(session, cell, cycle, momento)

    prediction = Prediction(
        cell_id=cell.id,
        crop_cycle_id=cycle.id,
        as_of=momento,
        # La version compuesta: motor + impacto. Dos predicciones calculadas con
        # modelos de impacto distintos tienen que ser distinguibles aunque la
        # formula del riesgo no haya cambiado ni una coma.
        model_version=f"{result.model_version}+{IMPACT_VERSION}",
        projected_yield_kg=result.projected_yield_kg,
        projected_boxes=result.projected_boxes,
        estimated_loss_percentage=result.estimated_loss_percentage,
        risk_score=result.risk_score,
        risk_level=result.risk_level.value,
        factors=result.factors.as_dict(),
        inputs=result.inputs,
    )
    session.add(prediction)
    session.commit()
    session.refresh(prediction)
    return prediction


def list_predictions_for_cell(
    session: Session,
    cell_id: uuid.UUID,
    crop_cycle_id: uuid.UUID | None = None,
) -> list[Prediction]:
    """Historial de la celda, mas reciente primero."""
    get_cell(session, cell_id)  # 404 si la celda no existe

    statement = select(Prediction).where(Prediction.cell_id == cell_id)
    if crop_cycle_id is not None:
        statement = statement.where(Prediction.crop_cycle_id == crop_cycle_id)

    return list(
        session.scalars(statement.order_by(Prediction.created_at.desc(), Prediction.id))
    )


def build_plot_timeline(
    session: Session,
    plot_id: uuid.UUID,
    crop_cycle_id: uuid.UUID,
) -> tuple[Plot, CropCycle, list[tuple[datetime, int]]]:
    """Los instantes de los que CERES ya ha hablado sobre este lote.

    Se LEEN de `predictions.as_of`, no se calculan. Es lo que hace que la
    interfaz pueda ofrecer un eje temporal sin inventarse fechas ni deducirlas
    de `planted_at`: los instantes correctos son los que alguien escribio, y
    estan en la tabla.

    Las predicciones sin fecha --`as_of IS NULL`, el estado base-- no entran: no
    se pueden situar en un eje.
    """
    plot = get_plot(session, plot_id)
    cycle = _get_crop_cycle(session, crop_cycle_id)

    if cycle.plot_id != plot.id:
        raise ConflictError(
            f"El ciclo {cycle.slug} se siembra en el lote {cycle.plot_id}, no en {plot.id}"
        )

    filas = session.execute(
        select(Prediction.as_of, func.count())
        .join(GridCell, GridCell.id == Prediction.cell_id)
        .where(GridCell.plot_id == plot_id)
        .where(Prediction.crop_cycle_id == crop_cycle_id)
        .where(Prediction.as_of.is_not(None))
        .group_by(Prediction.as_of)
        .order_by(Prediction.as_of)
    ).all()

    return plot, cycle, [(momento, total) for momento, total in filas]


def build_plot_overview(
    session: Session,
    plot_id: uuid.UUID,
    crop_cycle_id: uuid.UUID,
    as_of: datetime | None = None,
) -> tuple[Plot, CropCycle, list[tuple[GridCell, PredictionResult]]]:
    """Ejecuta el motor sobre todas las celdas del lote SIN persistir nada.

    Es lo que colorea la malla. Deliberadamente no escribe en `predictions`:
    guardar una fila por celda cada vez que alguien abre el dashboard llenaria
    de ruido el historico y destruiria justo lo que lo hace valioso —poder
    responder "que predijo CERES aquel dia"—.

    Persistir sigue siendo exclusivo de `create_prediction`, al hacer click en
    una celda concreta.

    `as_of` DECIDE QUE VE EL MAPA. Sin fecha se pinta el estado base, que es lo
    unico que habia hasta ahora, y por eso las zonas de evento eran invisibles:
    una finca con 9.900 observaciones fechadas salia entera del mismo color
    porque el mapa no las miraba. Con fecha, cada celda se deriva con
    `state_at`, igual que una prediccion guardada, y las zonas aparecen donde
    estan.

    Las observaciones se cargan de una vez para todo el lote, no una consulta
    por celda: con 10.000 celdas eso serian 10.000 idas y vueltas.
    """
    plot = get_plot(session, plot_id)
    cycle = _get_crop_cycle(session, crop_cycle_id)

    if cycle.plot_id != plot.id:
        raise ConflictError(
            f"El ciclo {cycle.slug} se siembra en el lote {cycle.plot_id}, no en {plot.id}"
        )

    cells = list(
        session.scalars(
            select(GridCell)
            .where(GridCell.plot_id == plot_id)
            .order_by(GridCell.y, GridCell.x)
        )
    )

    # El area sale del lote una sola vez, no una consulta por celda.
    area_m2 = plot.cell_size_m**2

    if as_of is None:
        results = [(cell, predict(cell, cycle.crop, area_m2=area_m2)) for cell in cells]
        return plot, cycle, results

    # Una sola consulta para las observaciones de todo el lote, agrupadas en
    # memoria por celda. La alternativa —`cell_state_at` celda a celda— hace una
    # consulta por celda: 10.000 sobre una conexion remota.
    eventos: dict[uuid.UUID, list[ObservedEvent]] = {}
    filas = session.scalars(
        select(Observation)
        .join(GridCell, GridCell.id == Observation.cell_id)
        .where(GridCell.plot_id == plot_id)
        .where(Observation.observed_at <= as_of)
    )
    for observacion in filas:
        eventos.setdefault(observacion.cell_id, []).append(_as_event(observacion))

    results = [
        (
            cell,
            predict(
                state_at(cell, eventos.get(cell.id, ()), as_of),
                cycle.crop,
                area_m2=area_m2,
            ),
        )
        for cell in cells
    ]

    return plot, cycle, results
