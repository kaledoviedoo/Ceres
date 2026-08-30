# CERES

Digital Twin agricola. Representa una finca como una malla de celdas de ~1 m2 y
cierra el ciclo:

```
ESTADO  ->  PREDICCION  ->  OBSERVACION  ->  COSECHA  ->  VALIDACION
```

> ## ⚠️ DEMO / SYNTHETIC DATA
>
> La finca de este repositorio **es ficticia** y todos sus datos son sinteticos y
> generados por un script. Las cifras existen para validar el sistema
> tecnicamente.
>
> El motor de prediccion es un **modelo experimental y demostrativo**, no una
> prediccion agronomica cientificamente validada. En palabras exactas:
> *"CERES prototype estimates yield using a deterministic synthetic model."*
> Hasta que haya datos reales y validacion experimental, no se afirma nada mas
> fuerte que eso.
>
> Los supuestos sinteticos del modelo estan listados uno a uno en
> [prediction-model.md](docs/prediction-model.md#supuestos-puramente-sinteticos).

---

## Estado del proyecto

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Inspeccion y arquitectura | ✅ |
| 1 | Modelo de dominio, schemas, tipos | ✅ |
| 2 | Migraciones, seeds, dataset sintetico | ✅ |
| 3 | Motor de prediccion `predict()` | ✅ |
| 4 | Endpoints FastAPI | ✅ |
| 5 | Frontend 2D (grid 20x20) | ⬜ siguiente |
| 6 | Integracion Next.js ↔ FastAPI | ⬜ |
| 7 | React Three Fiber | ⬜ |
| 8 | Observaciones | ⬜ |
| 9 | Cosechas y error de prediccion | ⬜ |
| 10 | Historico prediccion vs realidad | ⬜ |

Lo que hay ahora: el ciclo `celda -> motor -> API -> JSON` cerrado y testeado
de extremo a extremo, sobre datos sinteticos reproducibles. Todavia no hay
frontend.

**Aviso sobre los tests:** no hay Docker en la maquina de desarrollo, asi que los
tests de integracion corren sobre SQLite en memoria. Nada se ha ejecutado contra
PostgreSQL real. La lista de lo que queda pendiente de verificar esta en
[api.md](docs/api.md#que-se-ha-probado-y-contra-que).

---

## Puesta en marcha

Requisitos: Python 3.11+, Docker (o una base de datos Supabase).

### 1. Entorno virtual

Se crea **fuera** del repositorio a proposito: el proyecto vive en una carpeta
sincronizada por OneDrive, y un `.venv` dentro serian decenas de miles de
archivos sincronizandose sin parar (ver [D-013](docs/decisions.md)).

```bash
py -m venv C:\Users\User\.virtualenvs\ceres
C:\Users\User\.virtualenvs\ceres\Scripts\Activate.ps1
pip install -r apps/api/requirements.txt
```

### 2. Configuracion

```bash
cp .env.example .env
```

### 3. Base de datos

```bash
docker compose up -d db
py scripts/apply_migrations.py
```

Para Supabase: cambia `DATABASE_URL` en `.env` por la connection string del
panel y ejecuta el mismo comando. Los `.sql` de `database/migrations/` tambien
se pueden pegar directamente en el editor SQL de Supabase.

### 4. Datos de demo

```bash
py scripts/generate_demo_data.py --apply
```

Genera 1 finca, 2 lotes, 800 celdas, 1 ciclo de cultivo y 24 observaciones.

### 5. Levantar la API

```bash
cd apps/api
uvicorn app.main:app --reload
```

Swagger en http://localhost:8000/docs

### 6. Tests

```bash
cd apps/api
pytest                    # todo
pytest tests/unit         # sin base de datos
pytest tests/integration  # SQLite en memoria, no PostgreSQL
```

---

## Comandos

| Comando | Que hace |
|---|---|
| `py scripts/apply_migrations.py` | Aplica migraciones pendientes |
| `py scripts/apply_migrations.py --status` | Solo informa del estado |
| `py scripts/generate_demo_data.py` | Escribe `database/seeds/0001_demo_data.sql` |
| `py scripts/generate_demo_data.py --apply` | Ademas lo ejecuta en la BD |
| `py scripts/generate_demo_data.py --seed 7` | Otra finca, igual de reproducible |
| `psql "$DATABASE_URL" -f scripts/reset_demo_data.sql` | Vacia todas las tablas |
| `py scripts/preview_predictions.py` | Predice las 400 celdas y muestra 3 ejemplos |
| `cd apps/api && uvicorn app.main:app --reload` | Levanta la API en :8000 |
| `cd apps/api && pytest` | Tests |

---

## Estructura

```
ceres/
├── apps/api/app/
│   ├── domain/         enums y umbrales compartidos
│   ├── core/
│   │   ├── prediction/ motor: features, yield, loss, risk, boxes, engine
│   │   └── synthetic/  generador determinista de terreno
│   ├── models/         SQLAlchemy — persistencia
│   ├── schemas/        Pydantic — contrato de API
│   ├── services/       consultas SQL y orquestacion
│   ├── api/v1/         routers HTTP (finos)
│   ├── main.py         la app FastAPI
│   ├── config.py
│   └── db.py
├── apps/api/tests/
│   ├── unit/           sin base de datos
│   └── integration/    SQLite en memoria
├── database/
│   ├── migrations/     SQL versionado (fuente de verdad del esquema)
│   └── seeds/          generado, no versionado
├── scripts/
└── docs/
```

`apps/web/` (Next.js) llega en la fase 5.

---

## La regla que sostiene todo

**El frontend no calcula agricultura.**

React Three Fiber hace hover, click, seleccion, colores y camara. Toda formula
—rendimiento, perdida, riesgo— vive en Python, en
`apps/api/app/core/prediction/`. El backend devuelve valores; el frontend decide
como pintarlos.

```python
from app.core.prediction import predict

result = predict(cell, crop, area_m2=1.0)
```

---

## Documentacion

| Documento | Contenido |
|---|---|
| [architecture.md](docs/architecture.md) | Capas, reglas invariantes, que deja preparado |
| [data-model.md](docs/data-model.md) | Entidades, relaciones, tablas |
| [prediction-model.md](docs/prediction-model.md) | Formulas, supuestos sinteticos, propiedades conocidas |
| [synthetic-data.md](docs/synthetic-data.md) | Como se genera la finca ficticia |
| [api.md](docs/api.md) | Contrato de endpoints |
| [decisions.md](docs/decisions.md) | Por que el sistema es como es |

---

## Criterio de exito del MVP

Un agronomo entra al dashboard, elige finca → lote → ciclo, ve una malla de
20 × 20, hace click en una celda, y CERES le devuelve rendimiento proyectado,
cajas, perdida estimada, riesgo y los factores que lo explican. Despues registra
una observacion, mas tarde la cosecha real, y CERES le dice cuanto se equivoco.

Si eso funciona de extremo a extremo, el MVP es valido.
