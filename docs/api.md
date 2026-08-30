# API

> **Estado: CONTRATO DEFINIDO, ENDPOINTS NO IMPLEMENTADOS.** Los schemas
> Pydantic ya existen en `app/schemas/` (fase 1). Los routers se implementan en
> la **fase 4**.

Base: `/api/v1`. REST + JSON.

Regla: ningun endpoint devuelve diccionarios arbitrarios. Todo entra y sale por
un schema Pydantic.

## Endpoints

| Metodo | Ruta | Respuesta | Fase |
|---|---|---|---|
| GET | `/farms` | `list[FarmRead]` | 4 |
| GET | `/farms/{farm_id}` | `FarmDetail` | 4 |
| GET | `/plots/{plot_id}` | `PlotRead` | 4 |
| GET | `/plots/{plot_id}/cells` | `CellCollection` | 4 |
| GET | `/cells/{cell_id}` | `CellRead` | 4 |
| POST | `/predictions` | `PredictionRead` | 4 |
| GET | `/cells/{cell_id}/predictions` | `PredictionList` | 4 |
| POST | `/observations` | `ObservationRead` | 8 |
| GET | `/cells/{cell_id}/observations` | `list[ObservationRead]` | 8 |
| POST | `/harvests` | `HarvestRead` | 9 |
| GET | `/cells/{cell_id}/harvests` | `list[HarvestRead]` | 9 |
| GET | `/cells/{cell_id}/performance` | `CellPerformance` | 10 |

## Carga de la malla

`GET /plots/{plot_id}/cells` devuelve las **400 celdas de una vez**, junto con
`grid_width`, `grid_height` y `cell_size_m`.

Esto no es una optimizacion prematura, es una decision de arquitectura: una
peticion por celda serian 400 round-trips para pintar una pantalla, y ese patron
es imposible de deshacer una vez que el frontend depende de el. El detalle de una
celda concreta (`GET /cells/{id}`) se pide solo al hacer click.

```json
{
  "plot_id": "…",
  "grid_width": 20,
  "grid_height": 20,
  "cell_size_m": 1.0,
  "cells": [
    {
      "id": "…",
      "cell_code": "A-00001",
      "x": 0, "y": 0,
      "elevation_m": 1179.87,
      "slope_deg": 1.42,
      "soil_quality": 0.4361,
      "plant_density": 2.5892,
      "health_factor": 0.6104,
      "base_yield_factor": 0.9871
    }
  ]
}
```

`CellSummary` es deliberadamente compacto: es lo que se multiplica por 400.

## POST /predictions

El frontend manda **solo identificadores**. No calcula nada.

```json
{ "cell_id": "…", "crop_cycle_id": "…" }
```

Respuesta: `PredictionRead`, con `factors` para explicar el resultado y
`model_version` para saber quien lo produjo. Cada llamada **crea una fila
nueva**; no hay `PUT /predictions/{id}`, y no lo habra.

## GET /cells/{cell_id}/performance

El endpoint que cierra el ciclo. Devuelve cada prediccion emparejada con su
cosecha real:

```json
{
  "cell_id": "…",
  "cell_code": "A-00123",
  "crop_cycle_id": "…",
  "entries": [
    {
      "prediction_id": "…",
      "predicted_at": "2026-08-30T14:00:00Z",
      "model_version": "rule-based-v0.1",
      "projected_yield_kg": 18.4,
      "actual_yield_kg": 16.2,
      "absolute_error_kg": 2.2,
      "percentage_error": 13.58
    }
  ]
}
```

`absolute_error_kg` y `percentage_error` son `null` mientras no exista cosecha.
`percentage_error` tambien es `null` si el rendimiento real es 0: no se inventa
un numero para una division imposible.

## Convenciones

- **Errores**: `422` validacion (Pydantic), `404` recurso inexistente,
  `409` conflicto de estado.
- **Fechas**: ISO 8601 UTC. `harvested_at` y `planted_at` son fechas sin hora.
- **Unidades**: siempre kg y metros. Las toneladas se derivan en el schema, no
  se guardan.
- **Colores**: la API no los devuelve. Devuelve valores; el frontend decide como
  pintarlos.

## Relacionado

- [architecture.md](architecture.md)
- [data-model.md](data-model.md)
- [prediction-model.md](prediction-model.md)
