# Modelo de prediccion

> **Estado: IMPLEMENTADO Y TESTEADO** (fase 3). Codigo en
> `apps/api/app/core/prediction/`. 190 tests en verde.

> ## ⚠️ MODELO EXPERIMENTAL / DEMOSTRATIVO
>
> Este MVP utiliza datos geograficos y agricolas **sinteticos**. El motor de
> prediccion debe considerarse un modelo **experimental y demostrativo**, y **no**
> una prediccion agronomica cientificamente validada.
>
> Formulacion admisible: *"CERES prototype estimates yield using a deterministic
> synthetic model."* Nada mas fuerte que eso hasta que existan datos reales y
> validacion experimental.

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

## Etapas del motor

Cada etapa es un modulo con una responsabilidad y una formula:

| Modulo | Responsabilidad |
|---|---|
| `features.py` | extraccion y normalizacion |
| `yield_model.py` | rendimiento y factores explicativos |
| `loss.py` | perdida estimada |
| `risk.py` | riesgo y su clasificacion |
| `boxes.py` | cajas necesarias |
| `engine.py` | orquestacion y construccion del resultado |
| `contracts.py` | tipos de entrada y salida, con sus invariantes |

```python
from app.core.prediction import predict

result = predict(cell, crop, area_m2=plot.cell_size_m ** 2)
```

`cell` y `crop` solo tienen que exponer los atributos de los protocolos
`CellState` y `CropSpec`. Un `GridCell` y un `Crop` de SQLAlchemy los cumplen sin
heredar de nada, y el motor sigue sin importar SQLAlchemy.

## 0. Normalizacion

```
slope_norm    = clip(slope_deg / 15, 0, 1)
density_ratio = plant_density / optimal_plant_density_per_m2
```

15 grados es la pendiente a partir de la cual se aplica la penalizacion maxima.

**La elevacion no entra en ninguna formula.** Solo se usa para *derivar* la
pendiente al generar el terreno, y para deformar la superficie en el render 3D.
Una celda a 800 m y otra a 2800 m con la misma pendiente reciben identica
prediccion. Hay un test que lo fija.

## 1. Rendimiento proyectado

```
density_factor  = clip(density_ratio, 0, 1.15)
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

Multiplicativo por dos razones: el desglose se lee directo en la UI ("Suelo
+10%, Sanidad -15%, Terreno -8%"), y una celda con sanidad 0 debe dar 0 kg, cosa
que un modelo aditivo no garantiza.

`density_factor` se topa en 1.15: sembrar mas denso ayuda hasta un punto, y
pasado ese punto las plantas compiten entre si.

**Garantia:** todos los factores son >= 0 y `base_yield` > 0, asi que
`projected_yield_kg` nunca es negativo.

## 2. Cajas proyectadas

```
projected_boxes = ceil(projected_yield_kg / box_capacity_kg)
```

Sobre el rendimiento **bruto**, no sobre el neto de perdidas: la pregunta
operativa es cuantas cajas llevar al campo, y sobran mejor que faltan.

El rendimiento se redondea a 4 decimales **antes** de dividir. Es deliberado:
`ceil(12.000000000000002 / 6)` da 3 cajas en vez de 2, y las cajas que se
guardan tienen que corresponder al rendimiento que se guarda.

## 3. Perdida estimada

Aditivo, al reves que el rendimiento, porque las causas de perdida se acumulan:

```
base_loss     = 3.0                                # manejo y postcosecha
terrain_loss  = 12.0 * slope_norm                  # erosion, dificultad de recoleccion
health_loss   = 25.0 * (1 - health_factor)         # causa dominante
soil_loss     = 10.0 * (1 - soil_quality)

estimated_loss_percentage = clip(suma, 0, 100)
```

Maximo teorico: 3 + 12 + 25 + 10 = **50%**. El `clip` esta igualmente, porque un
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
cambiar de una semana a otra y sobre lo que un agronomo puede actuar; el terreno
es una condicion fija.

| `risk_score` | `risk_level` |
|---|---|
| < 0.33 | `low` |
| 0.33 .. 0.66 | `medium` |
| >= 0.66 | `high` |

Los umbrales viven en `app/domain/units.py`, definidos una sola vez.

## Salida

```json
{
  "cell_id": "5f3a…",
  "cell_code": "A-00240",
  "projected_yield_kg": 11.9634,
  "projected_yield_tons": 0.0119634,
  "projected_boxes": 2,
  "estimated_loss_percentage": 9.18,
  "risk_score": 0.1492,
  "risk_level": "low",
  "model_version": "rule-based-v0.1",
  "factors": {
    "density_factor": 1.0604,
    "soil_factor": 1.0610,
    "health_factor": 0.9290,
    "terrain_factor": 0.9662,
    "base_yield_factor": 0.9872
  }
}
```

`factors` no es decoracion: es lo que hace la prediccion auditable. El producto
de los cinco factores por el potencial del cultivo reconstruye exactamente
`projected_yield_kg`, y hay un test que lo comprueba.

`PredictionResult` valida sus invariantes **al construirse**: es imposible que
exista un resultado con perdida del 130%, rendimiento negativo o un `risk_level`
que no corresponda a su `risk_score`.

---

## Propiedades conocidas del modelo v0.1

Comportamientos reales, no fallos. Se documentan para que nadie los descubra
como sorpresa en la fase 5.

### La sanidad sola no alcanza riesgo alto

`HEALTH_WEIGHT` es 0.45 y el umbral `high` es 0.66. Una celda con el cultivo
**muerto** pero buen suelo y terreno plano sale `medium`, no `high`.

No es incoherente: `risk_score` mide *cuantos factores de riesgo hay presentes*,
no *como de malo es el desenlace*. El desenlace ya lo dicen
`projected_yield_kg` (0 kg) y `estimated_loss_percentage`. Para llegar a `high`
hacen falta al menos dos factores malos a la vez.

Si al validar contra cosechas reales resulta contraintuitivo, se sube
`HEALTH_WEIGHT` y se publica `rule-based-v0.2`.

### El dataset sintetico llega a los tres niveles desde la fase 4.6

Hasta entonces no producia ninguna celda `high` (136 `low`, 264 `medium`, 0
`high`), asi que la vista de riesgo del frontend solo habria podido mostrar dos
de los tres colores.

Se resolvio **sin tocar el modelo**: los pesos, los umbrales y las formulas de
esta pagina son exactamente los mismos. Lo que cambio fue el generador
sintetico, que ahora incluye una zona critica localizada. Ver
[synthetic-data.md](synthetic-data.md#zona-critica--escenario-sintetico-de-estres).

Distribucion actual sobre Plot A con la seed 42:

```
risk_score   min 0.1357 | medio 0.4162 | max 0.9359
riesgo low      134 celdas
riesgo medium   232 celdas
riesgo high      34 celdas
```

Un test desactiva la zona critica y comprueba que sin ella no queda ninguna
celda `high`. Es lo que demuestra que el rojo sale del dataset y no de un umbral
ajustado a conveniencia.

---

## Supuestos puramente sinteticos

**Ninguna** de estas constantes procede de literatura agronomica ni de medicion
de campo. Todas estan marcadas con `SUPUESTO SINTETICO` en el codigo.

| Constante | Valor | Donde | Que asume |
|---|---|---|---|
| `SLOPE_REFERENCE_DEG` | 15° | `features.py` | pendiente de penalizacion maxima |
| `DENSITY_FACTOR_CAP` | 1.15 | `yield_model.py` | techo del beneficio de sobresembrar |
| `SOIL_FACTOR_FLOOR` / `SPAN` | 0.70 / 0.50 | `yield_model.py` | el suelo mueve el rendimiento entre -30% y +20% |
| `TERRAIN_SLOPE_PENALTY` | 0.25 | `yield_model.py` | la pendiente maxima cuesta un 25% del rendimiento |
| `BASE_LOSS_PCT` | 3.0 | `loss.py` | perdida de manejo inevitable |
| `TERRAIN_LOSS_PCT` | 12.0 | `loss.py` | perdida maxima por erosion y recoleccion |
| `HEALTH_LOSS_PCT` | 25.0 | `loss.py` | perdida maxima por sanidad |
| `SOIL_LOSS_PCT` | 10.0 | `loss.py` | perdida maxima por suelo |
| `HEALTH/SOIL/SLOPE_WEIGHT` | 0.45 / 0.30 / 0.25 | `risk.py` | orden de importancia del riesgo |
| `RISK_MEDIUM/HIGH_THRESHOLD` | 0.33 / 0.66 | `domain/units.py` | corte en tercios del rango |
| `base_yield_kg_per_m2` | 12.0 | dataset | rendimiento de referencia del tomate |
| `box_capacity_kg` | 6.0 | dataset | kg por caja |
| `optimal_plant_density_per_m2` | 2.5 | dataset | densidad optima del tomate |

Ademas, el modelo **ignora por completo** clima, riego, fertilizacion, fecha
dentro del ciclo, variedad, historico de la parcela y cualquier interaccion
entre variables. Los cuatro factores de rendimiento se asumen **independientes**,
que es casi con seguridad falso en agronomia real (suelo pobre y estres hidrico
no se multiplican limpiamente).

## Cobertura de tests

`tests/unit/test_prediction.py`, `test_loss.py`, `test_risk.py` y
`test_prediction_dataset.py`:

- celda optima, media y deficiente
- densidad alta (techo), baja (proporcional) y cero
- elevacion (no influye) y pendiente (satura en la referencia)
- sanidad baja y cultivo muerto
- limites de perdida y de riesgo, barridos parametrizados
- cajas: redondeo hacia arriba y escala con el area
- determinismo, incluido sobre las 400 celdas del dataset
- `model_version` presente
- factores: reconstruyen el rendimiento y exponen los cinco documentados
- coherencia: tres celdas distintas se ordenan de forma monotona en rendimiento,
  perdida y riesgo
- validacion: entradas imposibles fallan al construirse

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
