"""Contrato de API: vista general de riesgo de un lote.

Lo que necesita el frontend para pintar la malla de un vistazo.

**Estos valores NO son predicciones persistidas.** Son el resultado de ejecutar
el motor sobre el estado actual de cada celda, calculado al vuelo y tirado.
Por eso no llevan `id` ni `created_at`: no existen en la tabla `predictions` y
no forman parte del historico.

La distincion importa. Una prediccion es una fotografia con fecha y version de
modelo que responde "que dijo CERES aquel dia". Esto es "que diria CERES ahora
mismo sobre las 400 celdas", y sirve para colorear un mapa. Persistir 400 filas
cada vez que alguien abre el dashboard llenaria el historico de ruido y
destruiria justo lo que lo hace valioso.

Persistir sigue siendo exclusivo de `POST /predictions`, al hacer click en una
celda concreta.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import Field

from app.domain.enums import RiskLevel
from app.schemas.common import CeresORMSchema


class CellOverview(CeresORMSchema):
    """Metricas de una celda para pintarla. Compacto: se multiplica por 400."""

    cell_id: uuid.UUID
    cell_code: str
    x: int = Field(ge=0, description="0 = oeste")
    y: int = Field(ge=0, description="0 = sur")

    projected_yield_kg: float = Field(ge=0)
    projected_boxes: int = Field(ge=0)
    estimated_loss_percentage: float = Field(ge=0, le=100)
    risk_score: float = Field(ge=0, le=1)
    risk_level: RiskLevel


class TimelineMoment(CeresORMSchema):
    """Un instante del que CERES ya ha hablado sobre este lote."""

    as_of: datetime = Field(description="El momento del que habla la prediccion")
    prediction_count: int = Field(ge=1, description="Cuantas celdas se predijeron")


class PlotTimeline(CeresORMSchema):
    """Respuesta de `GET /plots/{plot_id}/timeline`.

    QUE ES Y POR QUE NO ES UNA LISTA DE FECHAS INVENTADA
    ----------------------------------------------------
    `moments` sale de los `as_of` DISTINTOS que existen en `predictions` para
    este lote y ciclo. No es una lista que alguien haya escrito: es lo que el
    generador --o quien sea que haya lanzado predicciones-- dejo escrito.

    Existe porque el frontend necesitaba saber que instantes puede pedirle al
    mapa y no tenia de donde sacarlos: los momentos del escenario sintetico
    viven en `PREDICTION_MOMENTS`, dentro del generador, que la API no importa
    ni debe importar. La alternativa era que la interfaz se los inventara o los
    dedujera de `planted_at` y `expected_harvest_at`, y ninguna de las dos cosas
    da los instantes correctos: t0 es siembra + 30 dias y t2 es cosecha - 7.

    Un lote sin predicciones devuelve `moments` vacio, y eso es una respuesta:
    significa que no hay ningun momento del que se pueda ensenar el estado.
    """

    plot_id: uuid.UUID
    crop_cycle_id: uuid.UUID
    #: Fechas del ciclo. Viajan para poder situar cada momento dentro de el, no
    #: para usarlas COMO momentos: ninguna de las dos coincide con un `as_of`.
    planted_at: date | None = None
    expected_harvest_at: date | None = None
    moments: list[TimelineMoment] = Field(
        default_factory=list, description="En orden cronologico"
    )


class PlotOverview(CeresORMSchema):
    """Respuesta de `GET /plots/{plot_id}/overview`.

    Incluye las dimensiones de la malla para que el frontend no tenga que
    deducirlas recorriendo las celdas, y `model_version` para que la interfaz
    pueda decir con que modelo se calculo lo que esta mostrando.
    """

    plot_id: uuid.UUID
    crop_cycle_id: uuid.UUID
    grid_width: int = Field(gt=0)
    grid_height: int = Field(gt=0)
    cell_size_m: float = Field(gt=0)
    model_version: str = Field(examples=["rule-based-v0.1"])

    #: Aviso que viaja en el contrato: estos numeros no estan guardados.
    persisted: bool = Field(
        default=False,
        description="Siempre false: son metricas calculadas al vuelo, no predicciones guardadas",
    )

    cells: list[CellOverview]
