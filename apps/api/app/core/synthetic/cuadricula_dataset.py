"""LA CUADRICULA - de campo generado a filas de base de datos.

DATASET SINTETICO DE PRUEBA DE CERES.

Toma el campo de `cuadricula.py` y produce las filas de las nueve tablas. No
abre conexiones: quien escribe el SQL es `scripts/generate_cuadricula.py`.

LAS DOS COSAS QUE ESTE MODULO MANTIENE SEPARADAS
------------------------------------------------
La razon de ser del dataset es poder medir si CERES se equivoca, y eso exige que
lo que ocurrio y lo que CERES predice salgan de sitios distintos:

    VERDAD (`harvests`)                 PREDICCION (`predictions`)
    -------------------                 --------------------------
    `truth_yield_field()`, aqui         `app.core.prediction`, intacto
    ve la HUMEDAD latente               no la ve: no hay columna
    danos propios por evento            `impact-v0`
    residuo propio, no guardado         `base_yield_factor`, guardado
    sabe de las labores                 no sabe que hubo fungicida

Si la verdad se calculara con el motor, CERES se validaria contra si mismo y el
error seria cero por construccion. Que las dos formulas difieran no es un
descuido: es lo unico que hace medible el error.

NO SE DISENA PARA QUE CERES ACIERTE
-----------------------------------
`base_yield_kg_per_m2` se fija con UNA regla ciega, la misma para los cuatro
cultivos (ver `YIELD_REALIZATION_RATIO`), calculada antes de ejecutar ninguna
prediccion y sin mirar el error resultante. Que CERES mejore o empeore de t0 a
t2 lo decide el motor, no el generador. Si despues de medir alguien retocara
esta constante para que el error bajara, el dataset dejaria de servir para lo
que existe.

QUE NO CABE EN EL ESQUEMA, Y SE DICE
------------------------------------
Las labores agronomicas --NPK, fungicida, riego, cincelado, Boro/Zinc-- NO se
guardan. `ObservationType` es `pest | disease | water_stress | physical_damage |
other`, y meter una fertilizacion como `other` con una severidad la convertiria
en un dano, que es justo lo contrario de lo que es. Se simulan como parametros
de la verdad y quedan listadas en el manifiesto.

"Riego semanal" tampoco se convierte en fechas: el escenario no las da. Entra
como parte de la base hidrica del lote de zanahoria y se declara asi.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Iterator, Literal

import numpy as np

from app.core.prediction import engine as prediction_engine
from app.core.provenance import DATASET_KIND
from app.core.state import IMPACT_VERSION, DerivedCellState, ObservedEvent, state_at
from app.core.synthetic import cuadricula as escenario
from app.core.synthetic.cuadricula import (
    CELL_SIZE_M,
    FARM_ID,
    GENERATOR_VERSION,
    MASTER_SEED,
    ORGANIZATION_NAME,
    ORGANIZATION_SLUG,
    PLOT_CELLS,
    PLOT_ORDER,
    REFERENCE_CELLS,
    SCENARIO,
    SCENARIO_BY_CODE,
    CropScenario,
    PlotField,
    build_all_fields,
    build_cell_code,
    cell_centroid,
    cell_index_to_local,
    cuadricula_uuid,
    plot_origin_latlon,
)
from app.domain.enums import CropCycleStatus, ObservationType, Provenance

MANIFEST_HEADLINE = "Dataset sintetico de prueba de CERES."


# =============================================================================
# CALIBRACION DEL POTENCIAL DEL CULTIVO
# =============================================================================

#: Que fraccion del potencial del cultivo se llega a recoger.
#:
#: SUPUESTO SINTETICO, y el mas importante del modulo:
#:
#:     base_yield_kg_per_m2 = objetivo_kg_por_celda / YIELD_REALIZATION_RATIO
#:
#: Es UNA regla, aplicada IGUAL a los cuatro cultivos, calculada antes de correr
#: ninguna prediccion. No se ajusta por lote ni se retoca despues de ver los
#: errores: hacerlo convertiria el dataset en una prueba disenada para que el
#: algoritmo aprobara.
#:
#: 0,75 dice "en un ciclo normal se recoge tres cuartas partes de lo que el
#: cultivo daria en condiciones ideales". Es una cifra de tanteo razonable, no
#: una medicion.
YIELD_REALIZATION_RATIO = 0.75


def base_yield_kg_per_m2(crop: CropScenario) -> float:
    """El potencial del cultivo que consume el motor."""
    return round(crop.target_kg_per_cell / YIELD_REALIZATION_RATIO, 6)


# =============================================================================
# EVENTOS DEL ESCENARIO
# =============================================================================


@dataclass(frozen=True, slots=True)
class AgronomicEvent:
    """Un evento del escenario, adverso o labor.

    `zone` nombra el campo que decide DONDE ocurre. Nunca es un rango de
    `cell_code`: la zona sale del campo latente o de la geometria del lote, y
    por eso resulta espacialmente contigua sin que haya que imponerlo.
    """

    plot_code: str
    name: str
    occurred_on: str
    kind: Literal["adverse", "labor"]
    zone: str
    #: Fraccion del lote afectada. SUPUESTO SINTETICO: fija la extension de la
    #: zona y con ella cuantas observaciones se generan.
    coverage: float = 0.0
    observation_type: ObservationType | None = None
    #: Cuanto rendimiento se lleva el evento EN LA VERDAD a severidad 1.
    #: No confundir con `HEALTH_IMPACT` de `impact-v0`: son modelos distintos a
    #: proposito. Estos salen de las celdas de referencia del escenario.
    truth_damage: float = 0.0
    #: Labor que mitiga un evento anterior del mismo lote, como factor sobre el
    #: dano de la verdad. CERES no se entera: no hay tabla de labores.
    mitigates: str | None = None
    mitigation_factor: float = 1.0
    note: str = ""

    @property
    def occurred_at(self) -> datetime:
        return datetime.fromisoformat(f"{self.occurred_on}T12:00:00+00:00")


#: Severidad minima y maxima dentro de una zona. SUPUESTO SINTETICO: evita
#: severidades 0 (una celda dentro de la zona esta afectada, aunque sea poco) y
#: 1,0 (nada esta destruido del todo).
SEVERITY_FLOOR = 0.10
SEVERITY_CEILING = 0.95

#: Danos de la VERDAD por tipo de evento, a severidad 1.
#:
#: Salen de las razones entre las celdas de referencia del propio escenario, no
#: de literatura agronomica:
#:     papa      gota           1,2 / 3,8  = 0,32
#:     maiz      estres hidrico 0,45 / 0,85 = 0,53
#:     zanahoria granizada      3,5 / 5,2  = 0,67
#: Son SUPUESTOS SINTETICOS, y difieren de `impact-v0` (0,45 / 0,30 / 0,25) a
#: proposito: esa diferencia es parte de lo que el dataset mide.
TRUTH_DAMAGE_DISEASE = 0.62
TRUTH_DAMAGE_WATER_STRESS = 0.45
TRUTH_DAMAGE_PHYSICAL = 0.30

EVENTS: tuple[AgronomicEvent, ...] = (
    # --- Papa -----------------------------------------------------------------
    AgronomicEvent("P", "Fertilizacion NPK", "2026-04-05", "labor", "whole_plot",
                   note="Labor de manejo. Sin tabla donde guardarla."),
    AgronomicEvent("P", "Gota (Phytophthora)", "2026-05-12", "adverse", "wettest",
                   coverage=0.18, observation_type=ObservationType.DISEASE,
                   truth_damage=TRUTH_DAMAGE_DISEASE,
                   note="Zona = 18 % mas humedo del lote: el fondo de la vaguada."),
    AgronomicEvent("P", "Fungicida", "2026-05-14", "labor", "whole_plot",
                   mitigates="Gota (Phytophthora)", mitigation_factor=0.55,
                   note="Corta la gota en la VERDAD. CERES no lo sabe: no hay labores."),
    # --- Maiz -----------------------------------------------------------------
    AgronomicEvent("M", "Riego", "2026-05-20", "labor", "whole_plot",
                   note="Labor puntual. Recogida en la base hidrica del lote."),
    AgronomicEvent("M", "Gusano cogollero", "2026-06-05", "adverse", "border",
                   coverage=0.18, observation_type=ObservationType.PEST,
                   truth_damage=TRUTH_DAMAGE_PHYSICAL,
                   note="Zona de borde: la plaga entra por los margenes del lote."),
    AgronomicEvent("M", "Estres hidrico", "2026-07-15", "adverse", "driest",
                   coverage=0.15, observation_type=ObservationType.WATER_STRESS,
                   truth_damage=TRUTH_DAMAGE_WATER_STRESS,
                   note="Zona = 15 % mas seco: la loma del noreste."),
    # --- Zanahoria ------------------------------------------------------------
    AgronomicEvent("Z", "Cincelado", "2026-04-25", "labor", "whole_plot",
                   note="Preparacion. Sin tabla donde guardarla."),
    AgronomicEvent("Z", "Riego semanal", "2026-05-01", "labor", "whole_plot",
                   note="SIN FECHAS en el escenario. No se inventan: entra como "
                        "base hidrica del lote."),
    AgronomicEvent("Z", "Granizada", "2026-07-10", "adverse", "hail_band",
                   coverage=0.20, observation_type=ObservationType.PHYSICAL_DAMAGE,
                   truth_damage=TRUTH_DAMAGE_PHYSICAL,
                   note="Banda meteorologica en el sur del lote, no topografica."),
    # --- Remolacha ------------------------------------------------------------
    AgronomicEvent("R", "Fertilizacion Boro/Zinc", "2026-05-15", "labor", "whole_plot",
                   note="Labor de manejo. Sin tabla donde guardarla."),
    AgronomicEvent("R", "Cercospora", "2026-06-20", "adverse", "wet_and_flat",
                   coverage=0.15, observation_type=ObservationType.DISEASE,
                   truth_damage=TRUTH_DAMAGE_DISEASE,
                   note="Zona humeda Y llana: donde el agua no corre."),
    AgronomicEvent("R", "Inundacion parcial", "2026-07-02", "adverse", "deepest",
                   coverage=0.12, observation_type=ObservationType.PHYSICAL_DAMAGE,
                   truth_damage=TRUTH_DAMAGE_PHYSICAL,
                   note="La hondonada cerrada. `physical_damage` y no "
                        "`water_stress`: el encharcamiento tambien degrada el suelo, "
                        "y es el unico tipo de CERES que toca las dos cosas."),
)

ADVERSE_EVENTS = tuple(e for e in EVENTS if e.kind == "adverse")
LABOR_EVENTS = tuple(e for e in EVENTS if e.kind == "labor")


#: Momentos de prediccion por lote: ~30 dias tras siembra y una semana antes de
#: cosecha. Los dos son anteriores al corte de la cosecha (00:00 UTC del dia
#: cosechado), asi que los dos emparejan.
#:
#: POR QUE DOS Y NO TRES. Hubo un momento intermedio, y en dos de los cuatro
#: lotes no aportaba nada: en papa todos los eventos ocurren antes del 15 de
#: junio y en zanahoria antes del 15 de julio, asi que t1 y t2 derivaban EL
#: MISMO estado --`impact-v0` no modela recuperacion ni crecimiento, o sea que
#: entre el ultimo evento y la cosecha no cambia nada-- y se guardaban 20.000
#: predicciones que repetian otras 20.000.
#:
#: Con dos momentos el dataset baja de 120.000 filas a 80.000 y la lectura es
#: mas simple: esto estimaba CERES al principio, y esto cerca de cosecha
#: despues de incorporar las observaciones. Si algun dia hace falta una
#: evolucion mas rica, se anade una fecha a esta tabla y nada mas.
PREDICTION_MOMENTS: dict[str, tuple[str, ...]] = {
    "P": ("2026-04-14", "2026-08-13"),
    "M": ("2026-05-10", "2026-09-08"),
    "Z": ("2026-05-31", "2026-08-23"),
    "R": ("2026-05-20", "2026-08-03"),
}


def moment(day: str) -> datetime:
    return datetime.fromisoformat(f"{day}T12:00:00+00:00")


# =============================================================================
# ZONAS: DONDE OCURRE CADA EVENTO
# =============================================================================


def zone_score(event: AgronomicEvent, field: PlotField) -> np.ndarray:
    """Campo continuo que decide donde ocurre el evento. Mayor = mas afectado.

    Cada zona sale de una magnitud del campo o de la geometria del lote. Ninguna
    sale de un rango de indices, que es lo que se pidio evitar: como los campos
    son espacialmente continuos, las zonas resultan contiguas solas.
    """
    ys = np.arange(PLOT_CELLS)[:, None] * np.ones((1, PLOT_CELLS))
    xs = np.arange(PLOT_CELLS)[None, :] * np.ones((PLOT_CELLS, 1))

    if event.zone == "wettest":
        return field.humidity
    if event.zone == "driest":
        return -field.humidity
    if event.zone == "deepest":
        return field.depression_m
    if event.zone == "wet_and_flat":
        # Humedo Y llano. El coeficiente convierte grados en unidades de humedad
        # para poder sumarlos. SUPUESTO SINTETICO.
        return field.humidity - 0.06 * field.slope_deg
    if event.zone == "border":
        # Distancia al borde mas cercano del lote, negada: el borde puntua alto.
        return -np.minimum.reduce([xs, ys, PLOT_CELLS - 1 - xs, PLOT_CELLS - 1 - ys])
    if event.zone == "hail_band":
        # Frente meteorologico: una banda recta que cruza el lote. La granizada
        # no sigue la topografia, asi que su zona tampoco.
        #
        # CONFLICTO DEL ESCENARIO, resuelto y anotado. El escenario situa la
        # granizada en la "zona sur" del lote, pero la celda de referencia con
        # dano foliar --Z-08000-- cae en y = 79, o sea el NORTE: en CERES y = 0
        # es el sur. Las dos cosas no pueden ser ciertas a la vez.
        #
        # Se elige la CELDA DE REFERENCIA y no la etiqueta, por dos razones: es
        # el dato mas especifico de los dos, y las ocho celdas se declararon
        # como puntos que el campo debe respetar. Con la banda en el sur,
        # Z-08000 salia intacta y con MAS rendimiento que la celda sana del
        # mismo lote, que es una incoherencia visible en los datos.
        diagonal = 0.85 * ys + 0.53 * xs
        ref_x, ref_y = cell_index_to_local(8000)
        centro = 0.85 * ref_y + 0.53 * ref_x
        return -np.abs(diagonal - centro)
    raise ValueError(f"zona desconocida: {event.zone!r}")


def zone_mask_and_severity(
    event: AgronomicEvent, field: PlotField
) -> tuple[np.ndarray, np.ndarray]:
    """Mascara booleana de la zona y severidad dentro de ella.

    La extension se fija por CUANTIL, no por umbral absoluto: asi la cobertura
    declarada se cumple exactamente y no depende de como haya salido el campo.
    """
    score = zone_score(event, field)
    umbral = float(np.quantile(score, 1.0 - event.coverage))
    mask = score >= umbral

    severidad = np.zeros_like(score)
    dentro = score[mask]
    if dentro.size:
        span = float(dentro.max() - dentro.min())
        if span <= 0:
            severidad[mask] = (SEVERITY_FLOOR + SEVERITY_CEILING) / 2.0
        else:
            severidad[mask] = SEVERITY_FLOOR + (SEVERITY_CEILING - SEVERITY_FLOOR) * (
                (dentro - dentro.min()) / span
            )
    return mask, severidad


def plot_events(plot_code: str) -> tuple[AgronomicEvent, ...]:
    return tuple(e for e in ADVERSE_EVENTS if e.plot_code == plot_code)


# =============================================================================
# LA VERDAD: RENDIMIENTO REAL POR CELDA
# =============================================================================


@dataclass(frozen=True, slots=True)
class TruthProfile:
    """Como se construye el rendimiento real. TODO SUPUESTO SINTETICO.

    Deliberadamente distinto del motor: exponentes sublineales donde el motor es
    lineal, y la humedad --que el motor no ve-- entrando directamente.
    """

    #: Anchura de la respuesta a la humedad. Mas estrecha que la de la sanidad:
    #: el rendimiento castiga el desajuste hidrico mas que la sanidad visible.
    humidity_sigma: float = 0.16
    #: Rendimientos decrecientes del suelo. El motor lo mapea lineal (0,70..1,20).
    soil_exponent: float = 0.50
    #: Rendimientos decrecientes de la densidad. El motor lo mapea lineal con techo.
    density_exponent: float = 0.70
    #: Dispersion del residuo propio de la verdad. NO se guarda en ninguna parte:
    #: es la parte del resultado que ningun modelo podria explicar.
    residual_spread: float = 0.09
    residual_lattice: int = 6
    floor: float = 0.02


TRUTH = TruthProfile()


def truth_yield_field(
    field: PlotField,
    crop: CropScenario,
    masks: dict[str, tuple[np.ndarray, np.ndarray]],
    seed: int = MASTER_SEED,
) -> np.ndarray:
    """Rendimiento real por celda, en kg, con la media del lote en el objetivo.

    Dos pasos, y el segundo es el que cumple la regla:

      1. rendimiento RELATIVO de cada celda, con toda su variacion espacial;
      2. un UNICO factor multiplicativo por lote para que la media caiga en el
         objetivo.

    Escalar no toca la dispersion relativa: la variacion entre celdas se
    conserva intacta y la media queda exacta. Repartir el promedio a partes
    iguales --lo que se pidio no hacer-- daria desviacion tipica cero, y hay un
    test que lo comprueba.
    """
    from app.core.synthetic.noise import smooth_noise

    desajuste = (field.humidity - crop.ideal_humidity) / TRUTH.humidity_sigma
    relativo = np.exp(-0.5 * desajuste**2)
    relativo = relativo * np.power(np.clip(field.soil_quality, 0.01, None), TRUTH.soil_exponent)
    ratio_densidad = np.clip(field.plant_density / crop.optimal_density_per_m2, 0.0, 1.0)
    relativo = relativo * np.power(ratio_densidad, TRUTH.density_exponent)

    # Danos por evento, multiplicativos: el orden no importa, la inclusion si.
    for event in plot_events(crop.code):
        mask, severidad = masks[event.name]
        atenuacion = 1.0
        for labor in LABOR_EVENTS:
            if labor.plot_code == crop.code and labor.mitigates == event.name:
                atenuacion *= labor.mitigation_factor
        relativo = relativo * (1.0 - event.truth_damage * atenuacion * severidad * mask)

    # Residuo propio de la verdad. Stream distinto de todos los del campo, asi
    # que no es deducible de nada que se guarde.
    plot_index = PLOT_ORDER.index(crop.code)
    rng = np.random.default_rng(np.random.SeedSequence([seed, plot_index, 99]))
    relativo = relativo * (
        1.0
        + TRUTH.residual_spread
        * smooth_noise(rng, PLOT_CELLS, PLOT_CELLS, lattice=TRUTH.residual_lattice)
    )
    relativo = np.clip(relativo, TRUTH.floor, None)

    factor = crop.target_kg_per_cell / float(relativo.mean())
    return relativo * factor


# =============================================================================
# ENSAMBLADO DE FILAS
# =============================================================================


@dataclass(frozen=True, slots=True)
class _CropSpecAdapter:
    """Lo que el motor necesita saber del cultivo, sin pasar por SQLAlchemy."""

    slug: str
    base_yield_kg_per_m2: float
    box_capacity_kg: float
    optimal_plant_density_per_m2: float


@dataclass
class CuadriculaDataset:
    """Las filas de la finca. Las tablas grandes se recorren, no se acumulan.

    Construir 40.000 celdas + 80.000 predicciones + 40.000 cosechas como listas
    ocuparia cientos de MB. Los iteradores generan lote a lote y el cargador
    inserta por bloques.
    """

    seed: int
    organizations: list[dict[str, Any]]
    farms: list[dict[str, Any]]
    plots: list[dict[str, Any]]
    crops: list[dict[str, Any]]
    crop_cycles: list[dict[str, Any]]
    fields: dict[str, PlotField]
    masks: dict[str, dict[str, tuple[np.ndarray, np.ndarray]]]
    truth: dict[str, np.ndarray]

    def plot_id(self, plot_code: str) -> uuid.UUID:
        return cuadricula_uuid("plot", plot_code)

    def cycle_id(self, plot_code: str) -> uuid.UUID:
        return cuadricula_uuid("crop_cycle", plot_code)

    def cell_id(self, plot_code: str, x: int, y: int) -> uuid.UUID:
        return cuadricula_uuid("grid_cell", plot_code, str(x), str(y))

    # --- Tablas grandes ------------------------------------------------------

    def iter_cells(self, plot_code: str) -> Iterator[dict[str, Any]]:
        field = self.fields[plot_code]
        plot_id = self.plot_id(plot_code)
        for y in range(PLOT_CELLS):
            for x in range(PLOT_CELLS):
                lat, lon = cell_centroid(plot_code, x, y)
                yield {
                    "id": self.cell_id(plot_code, x, y),
                    "plot_id": plot_id,
                    "cell_code": build_cell_code(plot_code, x, y),
                    "x": x,
                    "y": y,
                    "elevation_m": round(float(field.elevation_m[y, x]), 3),
                    "slope_deg": round(float(field.slope_deg[y, x]), 4),
                    "soil_quality": round(float(field.soil_quality[y, x]), 4),
                    "plant_density": round(float(field.plant_density[y, x]), 4),
                    "health_factor": round(float(field.health_factor[y, x]), 4),
                    "base_yield_factor": round(float(field.base_yield_factor[y, x]), 4),
                    "centroid_latitude": round(lat, 7),
                    "centroid_longitude": round(lon, 7),
                }

    def iter_observations(self, plot_code: str) -> Iterator[dict[str, Any]]:
        """Una observacion por celda dentro de la zona de cada evento adverso.

        Cobertura completa de la zona y no un muestreo de exploracion: en una
        SIMULACION el generador conoce el estado de cada celda, y una zona a
        medias dejaria celdas danadas en la verdad que CERES no tendria forma de
        ver. El limite honesto es que una exploracion real es dispersa, y queda
        anotado en el manifiesto.
        """
        cycle_id = self.cycle_id(plot_code)
        for event in plot_events(plot_code):
            mask, severidad = self.masks[plot_code][event.name]
            filas, columnas = np.nonzero(mask)
            for y, x in zip(filas.tolist(), columnas.tolist(), strict=True):
                yield {
                    "id": cuadricula_uuid("observation", plot_code, event.name, str(x), str(y)),
                    "cell_id": self.cell_id(plot_code, x, y),
                    "crop_cycle_id": cycle_id,
                    "type": event.observation_type.value,
                    "severity": round(float(severidad[y, x]), 4),
                    "description": f"{event.name} - {escenario.FARM_NAME} (dato sintetico)",
                    "observed_at": event.occurred_at,
                    "created_by": None,
                    # Nunca `measured`: lo genero yo.
                    "source_kind": Provenance.SYNTHETIC.value,
                }

    def _cell_events(self, plot_code: str, x: int, y: int) -> list[ObservedEvent]:
        eventos = []
        for event in plot_events(plot_code):
            mask, severidad = self.masks[plot_code][event.name]
            if mask[y, x]:
                eventos.append(
                    ObservedEvent(
                        observed_at=event.occurred_at,
                        type=event.observation_type,
                        severity=round(float(severidad[y, x]), 4),
                        source_kind=Provenance.SYNTHETIC,
                    )
                )
        return eventos

    def iter_predictions(self, plot_code: str) -> Iterator[dict[str, Any]]:
        """Tres predicciones por celda, calculadas POR EL MOTOR REAL.

        Se llama a `state_at` y a `predict` exactamente como lo hace
        `services/predictions.py`. El generador elige los momentos y nada mas:
        si reimplementara la formula, lo guardado no coincidiria con lo que
        devuelve `POST /predictions` al pinchar una celda.
        """
        crop = SCENARIO_BY_CODE[plot_code]
        field = self.fields[plot_code]
        spec = _CropSpecAdapter(
            slug=crop.crop_slug,
            base_yield_kg_per_m2=base_yield_kg_per_m2(crop),
            box_capacity_kg=crop.box_capacity_kg,
            optimal_plant_density_per_m2=crop.optimal_density_per_m2,
        )
        cycle_id = self.cycle_id(plot_code)
        momentos = [moment(d) for d in PREDICTION_MOMENTS[plot_code]]
        area = CELL_SIZE_M**2

        for y in range(PLOT_CELLS):
            for x in range(PLOT_CELLS):
                cell_id = self.cell_id(plot_code, x, y)
                base = DerivedCellState(
                    cell_code=build_cell_code(plot_code, x, y),
                    elevation_m=float(field.elevation_m[y, x]),
                    slope_deg=float(field.slope_deg[y, x]),
                    soil_quality=float(field.soil_quality[y, x]),
                    plant_density=float(field.plant_density[y, x]),
                    health_factor=float(field.health_factor[y, x]),
                    base_yield_factor=float(field.base_yield_factor[y, x]),
                )
                eventos = self._cell_events(plot_code, x, y)
                for etapa, cuando in enumerate(momentos):
                    estado = state_at(base, eventos, cuando, DATASET_KIND)
                    resultado = prediction_engine.predict(estado, spec, area_m2=area)
                    yield {
                        "id": cuadricula_uuid("prediction", plot_code, str(x), str(y), str(etapa)),
                        "cell_id": cell_id,
                        "crop_cycle_id": cycle_id,
                        "model_version": f"{resultado.model_version}+{IMPACT_VERSION}",
                        "as_of": cuando,
                        "projected_yield_kg": resultado.projected_yield_kg,
                        "projected_boxes": resultado.projected_boxes,
                        "estimated_loss_percentage": resultado.estimated_loss_percentage,
                        "risk_score": resultado.risk_score,
                        "risk_level": resultado.risk_level.value,
                        "factors": resultado.factors.as_dict(),
                        "inputs": resultado.inputs,
                    }

    def iter_harvests(self, plot_code: str) -> Iterator[dict[str, Any]]:
        crop = SCENARIO_BY_CODE[plot_code]
        rendimiento = self.truth[plot_code]
        cycle_id = self.cycle_id(plot_code)
        cosecha = date.fromisoformat(crop.harvested_at)
        for y in range(PLOT_CELLS):
            for x in range(PLOT_CELLS):
                kg = round(float(rendimiento[y, x]), 4)
                yield {
                    "id": cuadricula_uuid("harvest", plot_code, str(x), str(y)),
                    "cell_id": self.cell_id(plot_code, x, y),
                    "crop_cycle_id": cycle_id,
                    "actual_yield_kg": kg,
                    # A 1 m2 esta cifra no significa nada operativo: casi toda
                    # celda da 1 caja. Se guarda por integridad del esquema y
                    # queda anotado como metrica sin sentido a esta escala.
                    "actual_boxes": math.ceil(kg / crop.box_capacity_kg),
                    "harvested_at": cosecha,
                    "notes": None,
                    "created_by": None,
                }


def build_cuadricula_dataset(seed: int = MASTER_SEED) -> CuadriculaDataset:
    """Construye la finca entera. Funcion pura salvo por el campo, que ya lo es."""
    campos = build_all_fields(seed)

    mascaras: dict[str, dict[str, tuple[np.ndarray, np.ndarray]]] = {}
    for code in PLOT_ORDER:
        mascaras[code] = {
            event.name: zone_mask_and_severity(event, campos[code])
            for event in plot_events(code)
        }

    verdad = {
        crop.code: truth_yield_field(campos[crop.code], crop, mascaras[crop.code], seed)
        for crop in SCENARIO
    }

    organization_id = cuadricula_uuid("organization", ORGANIZATION_SLUG)
    farm_id = FARM_ID

    organizations = [
        {"id": organization_id, "name": ORGANIZATION_NAME, "slug": ORGANIZATION_SLUG}
    ]
    farms = [
        {
            "id": farm_id,
            "organization_id": organization_id,
            "name": escenario.FARM_NAME,
            "country": escenario.FARM_COUNTRY,
            "region": escenario.FARM_REGION,
            "latitude": escenario.FARM_LATITUDE,
            "longitude": escenario.FARM_LONGITUDE,
        }
    ]

    plots, crops, crop_cycles = [], [], []
    for crop in SCENARIO:
        origen_lat, origen_lon = plot_origin_latlon(crop.code)
        plots.append(
            {
                "id": cuadricula_uuid("plot", crop.code),
                "farm_id": farm_id,
                "name": crop.plot_name,
                "code": crop.code,
                "grid_width": PLOT_CELLS,
                "grid_height": PLOT_CELLS,
                "cell_size_m": CELL_SIZE_M,
                "origin_latitude": round(origen_lat, 7),
                "origin_longitude": round(origen_lon, 7),
            }
        )
        crops.append(
            {
                "id": cuadricula_uuid("crop", crop.crop_slug),
                "organization_id": organization_id,
                "name": crop.crop_name,
                "slug": crop.crop_slug,
                "variety": crop.variety,
                "box_capacity_kg": crop.box_capacity_kg,
                "base_yield_kg_per_m2": base_yield_kg_per_m2(crop),
                "optimal_plant_density_per_m2": crop.optimal_density_per_m2,
                "cycle_days": crop.cycle_days,
            }
        )
        crop_cycles.append(
            {
                "id": cuadricula_uuid("crop_cycle", crop.code),
                "plot_id": cuadricula_uuid("plot", crop.code),
                "crop_id": cuadricula_uuid("crop", crop.crop_slug),
                "name": f"{crop.crop_name} 2026",
                "slug": f"{crop.crop_slug}-2026",
                "status": CropCycleStatus.HARVESTED.value,
                "planted_at": date.fromisoformat(crop.planted_at),
                # La fecha REAL de cosecha vive en `harvests`. Aqui va la
                # esperada, y el escenario no declara ninguna distinta, asi que
                # se repite la misma y se dice que es lo que se hizo.
                "expected_harvest_at": date.fromisoformat(crop.harvested_at),
            }
        )

    return CuadriculaDataset(
        seed=seed,
        organizations=organizations,
        farms=farms,
        plots=plots,
        crops=crops,
        crop_cycles=crop_cycles,
        fields=campos,
        masks=mascaras,
        truth=verdad,
    )


# =============================================================================
# MANIFIESTO
# =============================================================================


def build_manifest(dataset: CuadriculaDataset, generated_at: datetime | None = None) -> dict[str, Any]:
    """Lo que hay que leer antes de creerse un numero salido de esta finca."""
    momento = generated_at or datetime.now(timezone.utc)

    anclajes = []
    for ref in REFERENCE_CELLS:
        campo = dataset.fields[ref.plot_code]
        x, y = cell_index_to_local(ref.index)
        anclajes.append(
            {
                "cell_code": build_cell_code(ref.plot_code, x, y),
                "declarado": {
                    "elevation_m": ref.elevation_m,
                    "humidity": ref.humidity,
                    "slope_pct": ref.slope_pct,
                    "density_per_m2": ref.density_per_m2,
                    "yield_kg": ref.yield_kg,
                    "condition": ref.condition,
                },
                "generado": {
                    "elevation_m": round(float(campo.elevation_m[y, x]), 2),
                    "humidity": round(float(campo.humidity[y, x]), 3),
                    "slope_pct": round(float(np.tan(np.radians(campo.slope_deg[y, x])) * 100), 2),
                    "density_per_m2": round(float(campo.plant_density[y, x]), 1),
                    "yield_kg": round(float(dataset.truth[ref.plot_code][y, x]), 3),
                },
            }
        )

    resumen = "\n".join(
        [
            "DATASET",
            f"{escenario.FARM_NAME}",
            f"{escenario.FARM_REGION}, Colombia",
            f"Synthetic / MVP    Seed: {dataset.seed}    Generador: {GENERATOR_VERSION}",
            "",
            "Finca:",
            f"- {len(SCENARIO)} ha productivas",
            f"- {len(SCENARIO)} lotes de 1 ha",
            f"- {PLOT_CELLS} x {PLOT_CELLS} m por lote",
            f"- {CELL_SIZE_M:.0f} m2 por celda "
            f"({PLOT_CELLS * PLOT_CELLS * len(SCENARIO):,} celdas en total)",
            f"- lat {escenario.FARM_LATITUDE}, lon {escenario.FARM_LONGITUDE}",
            "",
            "Lotes:",
            *[f"- {c.code} - {c.crop_name}"
              + (f" {c.variety}" if c.variety else "")
              + f"  ({c.target_t_per_ha} t/ha objetivo)" for c in SCENARIO],
            "",
            "Variables sinteticas por celda:",
            "- Elevacion, pendiente, calidad del suelo,",
            "  densidad de siembra, sanidad, factor de rendimiento",
            "",
            "Variables latentes (no se guardan, CERES no las ve):",
            "- Humedad, pH, residuo del rendimiento real, labores agronomicas",
            "",
            "Ground truth:",
            *[f"- {c.code}: {c.target_t_per_ha * 1000:,.0f} kg de cosecha real, "
              f"con variacion espacial por celda" for c in SCENARIO],
            "",
            "Procedencia:",
            "- Todas las observaciones = synthetic",
            "- Ninguna observacion representa una medicion real",
            "- Ningun propietario, tecnico, agricultor ni cliente real",
            "- created_by = NULL en todas las tablas",
            "",
            "La Cuadricula no representa una finca real ni datos de un cliente.",
            "Es un escenario sintetico construido para validar CERES.",
        ]
    )

    return {
        "headline": MANIFEST_HEADLINE,
        "summary": resumen,
        "disclaimer": (
            "La Cuadricula NO representa una finca real ni datos de un cliente. "
            "Es un escenario sintetico construido para validar CERES. Ni la "
            "finca, ni las celdas, ni las observaciones, ni las cosechas "
            "corresponden a ninguna medicion de campo. Todo el dataset es "
            "`synthetic`."
        ),
        "representation": (
            "Representamos la finca a resolucion de 1 m2 por celda utilizando un "
            "campo sintetico espacialmente correlacionado. Son 40.000 unidades "
            "de representacion, no 40.000 mediciones."
        ),
        "generator": {
            "version": GENERATOR_VERSION,
            "module": "app.core.synthetic.cuadricula",
            "seed": dataset.seed,
            "generated_at": momento.isoformat(),
            "reproducible": "misma semilla -> mismos arrays, bit a bit",
        },
        "provenance": {
            "dataset_kind": Provenance.SYNTHETIC.value,
            "measured_rows": 0,
            "created_by": "NULL en todas las tablas: no hay autenticacion y no "
                          "se inventa un autor, tecnico, agricultor ni sensor",
        },
        "del_escenario": {
            "descripcion": "Datos que vinieron dados y no se tocaron.",
            "campos": [
                "ubicacion de la finca (lat/lon, vereda, municipio, departamento)",
                "area productiva y numero de lotes",
                "cultivo, variedad, siembra y cosecha de cada lote",
                "rendimiento objetivo de cada lote (t/ha)",
                "humedad ideal y pH historico de cada cultivo",
                "las ocho celdas de referencia",
                "los doce eventos agronomicos y sus fechas",
            ],
        },
        "supuestos_sinteticos": {
            "descripcion": "Elegidos por nosotros. Ninguno es una medicion ni una "
                           "constante agronomica publicada.",
            "parametros": {
                "rbf_wide_sigma_m": escenario.RBF_WIDE_SIGMA_M,
                "rbf_local_sigma_m": escenario.RBF_LOCAL_SIGMA_M,
                "fit_bending_weight": escenario.FIT_BENDING_WEIGHT,
                "elevation_noise_m": escenario.ELEVATION_NOISE_M,
                "flood_hollow_depth_m": escenario.FLOOD_HOLLOW_DEPTH_M,
                "depression_blur_m": escenario.DEPRESSION_BLUR_M,
                "depression_trend_m": escenario.DEPRESSION_TREND_M,
                "humidity_k_depression": escenario.HUMIDITY_K_DEPRESSION,
                "humidity_k_slope": escenario.HUMIDITY_K_SLOPE,
                "humidity_plot_bases": {
                    k: round(v, 4)
                    for k, v in escenario.humidity_plot_bases(dataset.seed).items()
                },
                "yield_realization_ratio": YIELD_REALIZATION_RATIO,
                "truth_damage": {
                    "disease": TRUTH_DAMAGE_DISEASE,
                    "water_stress": TRUTH_DAMAGE_WATER_STRESS,
                    "physical_damage": TRUTH_DAMAGE_PHYSICAL,
                },
                "severity_range": [SEVERITY_FLOOR, SEVERITY_CEILING],
                "box_capacity_kg": {c.code: c.box_capacity_kg for c in SCENARIO},
            },
        },
        "variables_latentes": {
            "descripcion": "Gobiernan el escenario y NO se guardan en ninguna "
                           "columna. CERES no las ve.",
            "humidity": "topografia -> depresion local -> humedad. Coloca los "
                        "eventos y entra en el rendimiento real.",
            "ph": "declarado por lote. Entra en `soil_quality` y no sale.",
            "residuo_de_la_verdad": "ruido espacial propio del rendimiento real. "
                                    "Ningun modelo puede explicarlo.",
            "labores": "las seis del escenario. `ObservationType` no tiene termino "
                       "para ellas y no se disfrazan de dano.",
        },
        "topografia": {
            "metodo": "plano de minimos cuadrados sobre las 7 cotas declaradas + "
                      "funciones de base radial que cierran los residuos + "
                      "hondonada de inundacion + ruido de reticula suavizado",
            "superficie": "UNA sola de 220x220 m para los cuatro lotes: los "
                          "bordes casan porque es el mismo terreno",
            "limite": "el escenario declara cotas y pendientes locales que no son "
                      "del todo compatibles (2108->2112 en 40 m es 10 %, "
                      "etiquetados 3 % y 8 %). Se priorizan las cotas y la "
                      "pendiente se deriva.",
        },
        "eventos": {
            "adversos": [
                {
                    "lote": e.plot_code,
                    "nombre": e.name,
                    "fecha": e.occurred_on,
                    "tipo_ceres": e.observation_type.value,
                    "zona": e.zone,
                    "cobertura": e.coverage,
                    "nota": e.note,
                }
                for e in ADVERSE_EVENTS
            ],
            "labores_no_almacenadas": [
                {"lote": e.plot_code, "nombre": e.name, "fecha": e.occurred_on, "nota": e.note}
                for e in LABOR_EVENTS
            ],
            "metodo": "la zona es el cuantil superior de un campo continuo "
                      "(humedad, depresion, distancia al borde o banda "
                      "meteorologica). Nunca un rango de `cell_code`.",
            "cobertura_de_zona": "completa: una observacion por celda dentro de la "
                                 "zona. Una exploracion real es dispersa; esto es "
                                 "una simulacion y el generador conoce cada celda.",
        },
        "rendimiento": {
            "metodo": "rendimiento relativo por celda (humedad vs ideal, suelo^0,5, "
                      "densidad^0,7, danos por evento, residuo propio) y despues UN "
                      "solo factor por lote para que la media caiga en el objetivo",
            "objetivos_kg": {c.code: c.target_t_per_ha * 1000 for c in SCENARIO},
            "uniformidad": "prohibida: escalar no toca la dispersion relativa y hay "
                           "un test que exige desviacion tipica > 0",
        },
        "sin_leakage": {
            "verdad": "app.core.synthetic.cuadricula_dataset.truth_yield_field",
            "prediccion": "app.core.prediction, sin modificar",
            "garantia_estructural": "el motor consume el Protocol `CellState`, que "
                                    "tiene siete atributos y ninguno es rendimiento: "
                                    "`actual_yield_kg` no cabe en su entrada",
            "diferencias": [
                "la verdad ve la humedad latente; el modelo no tiene columna",
                "la verdad sabe que hubo fungicida; CERES no guarda labores",
                "danos de la verdad (0,62/0,45/0,30) != impact-v0 (0,45/0,30/0,25)",
                "residuos distintos y de streams distintos",
            ],
        },
        "anclajes": anclajes,
    }
