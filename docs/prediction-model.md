# Modelo de prediccion

> **Estado: DISENADO, NO IMPLEMENTADO.** Los contratos de entrada y salida ya
> existen en `app/core/prediction/contracts.py` (fase 1). Las formulas de este
> documento se implementan y se testean en la **fase 3**.

> DEMO / SYNTHETIC DATA — CERES estima rendimiento con un modelo determinista
> sintetico. No es una prediccion agronomica validada experimentalmente.

## Principio

Nada de machine learning todavia. Primero un modelo que sea:

- **determinista** — misma entrada, misma salida, siempre
- **explicable** — se puede senalar que factor bajo el resultado y cuanto
- **testeable** — sin base de datos, sin servidor
- **reemplazable** — el contrato sobrevive al cambio de formula

Un modelo malo pero explicable ensena mas que uno bueno pero opaco, porque
cuando llegue la cosecha real vamos a querer saber *por que* nos equivocamos.

## Version actual

```
MODEL_VERSION = "rule-based-v0.1"
```

Cada prediccion guarda su version. Cambiar una formula **nunca** reescribe
predicciones pasadas: se sube la version y las nuevas filas la llevan.

## Variable auxiliar

Casi todas las formulas usan la pendiente normalizada:

```
slope_norm = clip(slope_deg / 15, 0, 1)
```

15 grados es la pendiente a partir de la cual se aplica la penalizacion maxima.
Es una decision de producto para el MVP, no un umbral agronomico medido.

## 1. Rendimiento proyectado

```
density_factor  = clip(plant_density / optimal_plant_density, 0, 1.15)
soil_factor     = 0.70 + 0.50 * soil_quality          -> 0.70 .. 1.20
health_factor   = health_factor                        -> 0.00 .. 1.00
terrain_factor  = 1.00 - 0.25 * slope_norm             -> 0.75 .. 1.00

projected_yield_kg =
      base_yield_kg_per_m2
    * area_m2
    * density_factor
    * soil_factor
    * health_factor
    * terrain_factor
    * base_yield_factor
```

Multiplicativo a proposito: cada factor es un porcentaje del potencial, y el
desglose se lee directo en la UI ("Suelo +10%, Sanidad -15%, Terreno -8%").

`density_factor` se topa en 1.15: sembrar mas denso ayuda hasta un punto, y
pasado ese punto las plantas compiten entre si. Sin el tope, una celda
sobresembrada daria un rendimiento absurdo.

Ejemplo con los numeros del brief:

```
12 kg/m2 x 1 m2 x 0.95 x 1.10 x 0.85 x 0.92 = 9.80 kg
```

**Garantia:** todos los factores son >= 0 y `base_yield` > 0, asi que
`projected_yield_kg` nunca es negativo.

## 2. Cajas proyectadas

```
projected_boxes = ceil(projected_yield_kg / box_capacity_kg)
```

Se calcula sobre el rendimiento **bruto**, no sobre el neto de perdidas: la
pregunta operativa es cuantas cajas llevar al campo, y sobran mejor que faltan.

Pendiente de decidir en fase 9, cuando haya cosechas reales con las que
comparar: si el error sistematico es alto, se recalcula sobre el neto.

## 3. Perdida estimada

Aditivo, porque las causas de perdida se acumulan:

```
base_loss     = 3.0                                # manejo y postcosecha, inevitable
terrain_loss  = 12.0 * slope_norm                  # erosion, dificultad de recoleccion
health_loss   = 25.0 * (1 - health_factor)         # la causa dominante
soil_loss     = 10.0 * (1 - soil_quality)

estimated_loss_percentage = clip(suma, 0, 100)
```

Maximo teorico: 3 + 12 + 25 + 10 = 50%. El `clip` esta igualmente, porque un
cambio de pesos no puede permitirse producir 130% de perdida.

## 4. Riesgo

```
risk_score =
      0.45 * (1 - health_factor)
    + 0.30 * (1 - soil_quality)
    + 0.25 * slope_norm
```

Los pesos **suman 1.00**, y cada termino esta en 0..1, asi que `risk_score` cae
en 0..1 por construccion y no por recorte.

Sanidad pesa mas que suelo, y suelo mas que terreno: la sanidad es lo que puede
cambiar de una semana a otra y lo que un agronomo puede actuar; el terreno es
una condicion fija.

Bucket cualitativo (definido una sola vez, en `app/domain/units.py`):

| `risk_score` | `risk_level` |
|---|---|
| < 0.33 | `low` |
| 0.33 .. 0.66 | `medium` |
| >= 0.66 | `high` |

## Salida

```json
{
  "cell_id": "A-00123",
  "projected_yield_kg": 18.4,
  "projected_yield_tons": 0.0184,
  "projected_boxes": 4,
  "estimated_loss_percentage": 7.8,
  "risk_score": 0.21,
  "risk_level": "low",
  "model_version": "rule-based-v0.1",
  "factors": {
    "density_factor": 0.95,
    "soil_factor": 1.10,
    "health_factor": 0.85,
    "terrain_factor": 0.92,
    "base_yield_factor": 1.00
  }
}
```

`factors` no es decoracion: es lo que hace la prediccion auditable.

## Invariantes que la fase 3 debe testear

- `projected_yield_kg >= 0`
- `0 <= estimated_loss_percentage <= 100`
- `0 <= risk_score <= 1`
- `projected_boxes >= 0`
- misma entrada -> misma salida (determinismo)
- `model_version` siempre presente
- `risk_level` coherente con `risk_score`

## Lo que este modelo NO hace

No usa clima, ni imagenes de satelite, ni sensores, ni historico de cosechas.
No aprende. No se ajusta solo.

El camino previsto —y deliberadamente no implementado todavia— es:

```
rule-based  ->  estadistico  ->  ML  ->  Digital Twin adaptativo
```

Cada escalon necesita el anterior funcionando y datos reales de validacion.

## Relacionado

- [architecture.md](architecture.md)
- [synthetic-data.md](synthetic-data.md)
- [decisions.md](decisions.md)
