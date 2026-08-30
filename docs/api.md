# API

> **Estado: IMPLEMENTADA** (fase 4). Codigo en `apps/api/app/api/` y
> `apps/api/app/services/`. 60 tests de integracion en verde.

> **DEMO / SYNTHETIC DATA.** Las predicciones vienen de un modelo experimental y
> demostrativo sobre datos sinteticos. `GET /api/v1/health` devuelve ese aviso en
> el propio contrato, no solo en esta pagina.

Base: `/api/v1`. REST + JSON. Swagger en `/docs`.

```bash
cd apps/api
uvicorn app.main:app --reload
```

Regla: ningun endpoint devuelve diccionarios arbitrarios. Todo entra y sale por
un schema Pydantic.

## Endpoints

| Metodo | Ruta | Respuesta | Estado |
|---|---|---|---|
| GET | `/health` | `HealthResponse` | ✅ |
| GET | `/farms` | `list[FarmRead]` | ✅ |
| GET | `/farms/{farm_id}` | `FarmDetail` | ✅ |
| GET | `/plots/{plot_id}` | `PlotRead` | ✅ |
| GET | `/plots/{plot_id}/cells` | `CellCollection` | ✅ |
| GET | `/cells/{cell_id}` | `CellRead` | ✅ |
| POST | `/predictions` | `PredictionRead` (201) | ✅ |
| GET | `/cells/{cell_id}/predictions` | `PredictionList` | ✅ |
| POST | `/observations` | `ObservationRead` (201) | ✅ |
| GET | `/cells/{cell_id}/observations` | `list[ObservationRead]` | ✅ |
| POST | `/harvests` | `HarvestRead` (201) | ✅ |
| GET | `/cells/{cell_id}/harvests` | `list[HarvestRead]` | ✅ |
| GET | `/cells/{cell_id}/performance` | `CellPerformance` | ✅ |

`/cells/{id}/predictions` y `/cells/{id}/performance` aceptan `?crop_cycle_id=`
para filtrar por temporada.

## Como se atraviesan las capas

```
HTTP Request
    |
    v
app/api/v1/*.py        router: valida con un schema, llama a un servicio
    |
    v
app/services/*.py      consultas SQL y orquestacion
    |
    v
app/core/prediction/   motor puro: no sabe que existe FastAPI
    |
    v
app/models/            ORM -> PostgreSQL
    |
    v
JSON Response          schema Pydantic
```

Los routers no contienen SQL. Los servicios no conocen HTTP: lanzan
`NotFoundError` y `ConflictError`, y `app/api/exception_handlers.py` los traduce
a 404 y 409 en un unico sitio.

## POST /predictions

El cliente manda **solo identificadores**. El servidor carga la celda y el ciclo
de la base de datos, ejecuta el motor y persiste el resultado.

```http
POST /api/v1/predictions
{
  "cell_id": "408d5c38-b190-5642-b0d6-be6a24da7c87",
  "crop_cycle_id": "061a0981-eb72-5afe-976b-bb8fee631de8"
}
```

```json
201 Created
{
  "id": "64085863-d70a-4b7b-a8cc-ce4cecd416fb",
  "cell_id": "408d5c38-b190-5642-b0d6-be6a24da7c87",
  "crop_cycle_id": "061a0981-eb72-5afe-976b-bb8fee631de8",
  "model_version": "rule-based-v0.1",
  "projected_yield_kg": 11.9634,
  "projected_yield_tons": 0.0119634,
  "projected_boxes": 2,
  "estimated_loss_percentage": 9.18,
  "risk_score": 0.1492,
  "risk_level": "low",
  "factors": {
    "density_factor": 1.0604,
    "soil_factor": 1.061,
    "health_factor": 0.929,
    "terrain_factor": 0.9662,
    "base_yield_factor": 0.9872
  },
  "created_at": "2026-08-30T21:44:08"
}
```

### El servidor es la fuente de verdad

`PredictionCreate` declara `extra="forbid"`. Enviar valores agronomicos se
rechaza antes de tocar la base de datos:

```json
422 Unprocessable Entity
{
  "detail": [
    {"type": "extra_forbidden", "loc": ["body", "soil_quality"], "msg": "Extra inputs are not permitted"},
    {"type": "extra_forbidden", "loc": ["body", "projected_yield_kg"], "msg": "Extra inputs are not permitted"}
  ]
}
```

Cubre `soil_quality`, `health_factor`, `slope_deg`, `projected_yield_kg`,
`risk_score` y `model_version`, con un test por cada uno.

### Inmutabilidad

Cada POST crea una fila nueva. **No existe `PUT /predictions/{id}` ni
`DELETE`**, y no los habra: la inmutabilidad empieza por no ofrecer la
operacion. La base de datos lo refuerza con un trigger (migracion 0002).

## Carga de la malla

`GET /plots/{plot_id}/cells` devuelve las **400 celdas de una vez**, con
`grid_width`, `grid_height` y `cell_size_m`. Ordenadas por `(y, x)`: filas de sur
a norte, de oeste a este.

No es una optimizacion prematura sino lo contrario — una peticion por celda
serian 400 round-trips para pintar una pantalla, y ese patron es imposible de
deshacer una vez que el frontend depende de el. `CellSummary` es deliberadamente
compacto porque se multiplica por 400.

## GET /cells/{cell_id}/performance

El endpoint que cierra el ciclo.

```json
{
  "cell_id": "408d5c38-b190-5642-b0d6-be6a24da7c87",
  "cell_code": "A-00240",
  "crop_cycle_id": "061a0981-eb72-5afe-976b-bb8fee631de8",
  "entries": [
    {
      "prediction_id": "978d7802-6d1f-4714-9d8a-e2d40be5fb2f",
      "predicted_at": "2026-08-30T21:44:15",
      "model_version": "rule-based-v0.1",
      "projected_yield_kg": 11.9634,
      "projected_boxes": 2,
      "estimated_loss_percentage": 9.18,
      "risk_level": "low",
      "harvest_id": "a3284f8c-255c-47cc-a824-4b1cd0d366d2",
      "harvested_at": "2026-06-20",
      "actual_yield_kg": 10.4,
      "actual_boxes": 2,
      "absolute_error_kg": 1.5634,
      "percentage_error": 15.0327
    }
  ]
}
```

Se evalua **el historial completo**, no solo la ultima prediccion.
`absolute_error_kg` y `percentage_error` son `null` mientras no exista cosecha;
`percentage_error` tambien es `null` si el rendimiento real es 0, porque
dividir por cero no da un porcentaje enorme, no da nada.

## Codigos de estado

| Codigo | Cuando |
|---|---|
| 200 | lectura correcta |
| 201 | recurso creado (prediccion, observacion, cosecha) |
| 404 | el `cell_id`, `plot_id`, `farm_id` o `crop_cycle_id` no existe |
| 409 | la celda y el ciclo de cultivo pertenecen a lotes distintos |
| 422 | validacion del schema: UUID mal formado, rango invalido, campo extra |
| 500 | la base de datos no responde |

El 409 merece explicacion: pedir una prediccion para una celda de Plot B bajo un
ciclo que se siembra en Plot A es sintacticamente valido pero incoherente. Se
comprueba en el servicio, no en el schema, porque requiere leer la base de datos.

## Convenciones

- **Fechas**: ISO 8601 UTC. `harvested_at` y `planted_at` son fechas sin hora.
- **Unidades**: siempre kg y metros. Las toneladas se derivan en el schema.
- **Colores**: la API no los devuelve. Devuelve valores; el frontend decide como
  pintarlos.

---

## Que se ha probado y contra que

> Esta seccion es importante. **No hay Docker en la maquina de desarrollo**, asi
> que nada se ha ejecutado contra PostgreSQL de verdad.

### Verificado — SQLite en memoria (60 tests de integracion)

El esquema lo levanta el ORM con `Base.metadata.create_all()`.

- cableado completo HTTP -> servicio -> motor -> ORM -> respuesta
- que el resultado del endpoint coincide **exactamente** con ejecutar `predict()`
  a mano sobre la misma celda
- persistencia: cada POST crea una fila y no sobrescribe las anteriores
- schemas de request y response, incluido el rechazo de campos extra
- 404, 409 y 422
- el ciclo completo prediccion -> cosecha -> error

### Verificado — servidor real (smoke test manual)

`uvicorn app.main:app` arranca, `/docs` responde 200, las 13 rutas aparecen en
`/openapi.json`, y `/api/v1/health` devuelve 200 con `database: "unavailable"`
cuando no hay base de datos detras.

### PENDIENTE — requiere PostgreSQL / Supabase real

Nada de esto se ha ejecutado ni una vez:

| Que | Por que no se puede en SQLite |
|---|---|
| Las migraciones de `database/migrations/` | en los tests el esquema lo crea el ORM, no el SQL |
| El trigger de inmutabilidad (0002) | es PL/pgSQL |
| La vista `cell_performance` (0003) | usa `LEFT JOIN LATERAL` |
| Los CHECK constraints tal como los escribe el SQL | SQLite no los aplica igual |
| Tipos nativos `uuid`, `jsonb`, `timestamptz` | SQLite usa CHAR(32), JSON de texto y datetime naive |
| El seed `database/seeds/0001_demo_data.sql` | solo se ha validado por parsing |
| Comportamiento del pool de conexiones | SQLite usa `StaticPool` |

Primer paso en cuanto haya un Postgres disponible:

```bash
docker compose up -d db
py scripts/apply_migrations.py
py scripts/generate_demo_data.py --apply
cd apps/api && uvicorn app.main:app --reload
# y despues: POST /api/v1/predictions, seguido de un UPDATE manual sobre
# predictions para comprobar que el trigger de 0002 lo rechaza.
```

## Relacionado

- [architecture.md](architecture.md)
- [data-model.md](data-model.md)
- [prediction-model.md](prediction-model.md)
- [decisions.md](decisions.md)
