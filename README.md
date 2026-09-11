# CERES

![Python](https://img.shields.io/badge/python-3.11%2B-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![React Three Fiber](https://img.shields.io/badge/React_Three_Fiber-9-61dafb)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17%20%7C%2018-336791)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E)
![Tests](https://img.shields.io/badge/tests-937%20en%20verde-brightgreen)
![Licencia](https://img.shields.io/badge/licencia-AGPL--3.0-lightgrey)
![Estado](https://img.shields.io/badge/estado-MVP%20con%20datos%20sint%C3%A9ticos-orange)

Gemelo digital de una finca. Divide cada lote en celdas de 1 m², predice el rendimiento de cada una, registra lo que pasa en el campo y, cuando llega la cosecha, mide cuánto se equivocó — celda a celda y en cada momento del que habló.

```
ESTADO  ->  PREDICCION  ->  OBSERVACION  ->  COSECHA  ->  VALIDACION
```

> **DEMO / SYNTHETIC DATA.** Las dos fincas del repositorio son ficticias y todos sus datos los genera un script. El motor de predicción es un modelo experimental y demostrativo, no una predicción agronómica validada científicamente: *"CERES prototype estimates yield using a deterministic synthetic model."* Los supuestos están listados uno a uno en [prediction-model.md](docs/prediction-model.md#supuestos-puramente-sinteticos).

---

## Demo visual

```mermaid
flowchart LR
    S[Seed sintético<br/>generate_demo_data · generate_cuadricula] --> D[(PostgreSQL<br/>Supabase)]
    D --> A[FastAPI<br/>16 endpoints]
    A --> E[Motor de predicción<br/>predict · state_at]
    E --> A
    A --> W[Next.js + React Three Fiber<br/>:3000]
    W -->|finca → lote → ciclo → momento| A
    W -->|click en una celda| I[Cell Inspector<br/>predicción · cosecha · error]
    A --> P["/performance<br/>predicción vs realidad"]
```

El usuario elige finca, lote, ciclo y **momento**; el terreno se pinta en 3D con las métricas del motor para ese instante; al pulsar una celda, la ficha muestra qué predijo CERES ese día, qué se cosechó y el error entre ambos.

*(Capturas pendientes: la interfaz está en `apps/web`, ver «Instalación».)*

---

## Stack Tecnológico

| Capa | Herramientas |
|---|---|
| Backend | Python 3.11+, FastAPI 0.115, Pydantic v2 (`extra="forbid"` en toda entrada), SQLAlchemy 2, psycopg 3 |
| Motor | NumPy 2 (sin SciPy): reglas deterministas, derivación temporal `state_at`, ajuste Gauss-Newton para el terreno sintético |
| Base de datos | PostgreSQL 17 (Supabase) para la aplicación; PostgreSQL 18 local para la suite destructiva. 7 migraciones SQL versionadas, trigger de inmutabilidad, vista `cell_performance`, RLS |
| Frontend | Next.js 16 (App Router), React 19, TypeScript 5.7, Tailwind 4, Zustand 5 |
| 3D | three 0.185, React Three Fiber 9, drei 10 |
| Tests | pytest (SQLite en memoria + PostgreSQL real), Vitest 3 + Testing Library |
| Calidad | tsc, ESLint 9, tests de mutación en cada fase |

---

## Features principales

- **Celdas de 1 m², no promedios de lote.** Cada celda tiene su elevación, pendiente, suelo, densidad y sanidad. El rendimiento se predice y se cosecha por celda; el error se mide por celda.
- **Eje temporal real.** Cada predicción guarda de qué momento habla (`as_of`), distinto de cuándo se calculó (`created_at`). `GET /plots/{id}/timeline` lista los momentos de los que CERES ya habló; la interfaz los ofrece como selector. El estado de una celda en una fecha se deriva de sus observaciones anteriores a esa fecha.
- **La cosecha no depende de desde cuándo se mire.** Lo que cambia entre dos momentos es la predicción con la que se compara, y por tanto el error. `/performance` filtra el historial; nunca lo recalcula.
- **Predicciones inmutables.** Un trigger en la base de datos rechaza `UPDATE` y `DELETE`: cada ejecución añade una fotografía histórica, ninguna la reescribe.
- **Procedencia cerrada.** Cada dato declara si es `measured`, `derived`, `estimated`, `synthetic` o `unknown`, y `unknown` es el valor por defecto: callar produce «no lo sé», nunca «lo medí». La interfaz distingue lo medido de lo derivado y lo rotula.
- **Contrato coherente.** Celda y ciclo de lotes distintos reciben `409` en escritura y en lectura; un ciclo inexistente, `404`. Una lista vacía significa una sola cosa: ciclo válido, todavía sin datos.
- **El frontend no calcula agricultura.** Toda fórmula vive en Python. El navegador hace hover, click, colores y cámara, y pinta exactamente los valores que devuelve la API.
- **La Cuadrícula.** Finca sintética de 4 lotes × 1 ha (40.000 celdas), cuatro cultivos, una sola topografía compartida, humedad latente y eventos localizados (gota, gusano cogollero, estrés hídrico). La verdad y la predicción se generan por separado, con semilla fija, para poder validar el ciclo completo sin fabricar un resultado favorable. Detalle en [cuadricula.md](docs/cuadricula.md).
- **Suite PostgreSQL con barrera.** Los tests destructivos solo corren contra una base local de test; una barrera rechaza la base de la aplicación y cualquier host de Supabase, y ninguna variable de entorno la levanta.

---

## Instalación (Getting Started)

**Requisitos:** Python 3.11+, Node 20+, y una base PostgreSQL: Supabase (plan gratuito) o Docker.

```bash
git clone https://github.com/kaledoviedoo/Ceres.git
cd Ceres
```

**Entorno virtual.** Se crea fuera del repositorio a propósito (ver [D-013](docs/decisions.md)):

```powershell
py -m venv $HOME\.virtualenvs\ceres
& $HOME\.virtualenvs\ceres\Scripts\Activate.ps1
pip install -r apps/api/requirements.txt
```

```bash
# Linux o macOS
python -m venv ~/.virtualenvs/ceres && source ~/.virtualenvs/ceres/bin/activate
pip install -r apps/api/requirements.txt
```

**Credenciales.** Copia `.env.example` a `.env` y rellena `DATABASE_URL`. Con Supabase, la connection string de *Project Settings → Database* cambiando `postgresql://` por `postgresql+psycopg://` y añadiendo `?sslmode=require`:

```ini
DATABASE_URL=postgresql+psycopg://postgres.<PROJECT_REF>:<DB_PASSWORD>@aws-0-<REGION>.pooler.supabase.com:6543/postgres?sslmode=require
```

Con Docker: `docker compose up -d db` y el valor por defecto ya apunta a él.

**Base de datos y datos.**

```bash
py scripts/apply_migrations.py            # 7 migraciones, idempotente
py scripts/generate_demo_data.py --apply  # finca demo: 1 lote, 400 celdas, 24 observaciones
py scripts/generate_cuadricula.py --apply # La Cuadrícula: 4 lotes, 40.000 celdas (tarda ~3 min)
```

Los `.sql` de `database/migrations/` también se pueden pegar en el editor SQL de Supabase.

**API y frontend**, en dos terminales:

```bash
cd apps/api && uvicorn app.main:app --reload --port 8010     # Swagger en /docs
```

```bash
cd apps/web && cp .env.local.example .env.local && npm install && npm run dev
```

CERES en http://localhost:3000. `NEXT_PUBLIC_API_BASE_URL` se hornea en el build: si cambias el puerto de la API, hay que reconstruir.

**Comprobación.**

```bash
curl http://localhost:8010/api/v1/health
```

---

## Ejemplos de uso

Pedir el mapa de un lote en un momento concreto:

```bash
curl "http://localhost:8010/api/v1/plots/<plot_id>/overview?crop_cycle_id=<cycle_id>&as_of=2026-04-14T12:00:00Z"
```

Qué predijo CERES para una celda ese día, qué se cosechó y el error:

```bash
curl "http://localhost:8010/api/v1/cells/<cell_id>/performance?crop_cycle_id=<cycle_id>&as_of=2026-04-14T12:00:00Z"
```

```json
{
  "cell_id": "d1a620ce-…",
  "cell_code": "P-05797",
  "crop_cycle_id": "d66c9ae8-…",
  "entries": [{
    "as_of": "2026-04-14T12:00:00Z",
    "projected_yield_kg": 2.69,
    "harvested_at": "2026-08-20",
    "actual_yield_kg": 2.72,
    "absolute_error_kg": 0.03,
    "percentage_error": 1.25
  }]
}
```

Guardar una predicción (el servidor es la fuente de verdad: solo viajan identificadores):

```bash
curl -X POST http://localhost:8010/api/v1/predictions \
  -H "content-type: application/json" \
  -d '{"cell_id": "<cell_id>", "crop_cycle_id": "<cycle_id>", "as_of": "2026-04-14T12:00:00Z"}'
```

Ejecutar los tests:

```bash
cd apps/api && pytest                 # 566 sin PostgreSQL; 608 con TEST_DATABASE_URL
cd apps/web && npm test               # 329
cd apps/web && npm run typecheck && npm run lint
```

**Suite PostgreSQL.** Los tests de `apps/api/tests/postgres/` vacían tablas enteras y solo corren contra una base que puedan destruir: un PostgreSQL local con una base `ceres_test`. Si `TEST_DATABASE_URL` apunta a la base de la aplicación o a cualquier proyecto de Supabase se saltan con `POSTGRES TEST DATABASE NOT SAFE` (`tests/postgres/guard.py`). Para montarla una vez:

```sql
CREATE ROLE ceres LOGIN PASSWORD '...';
CREATE DATABASE ceres_test OWNER ceres;
```

```powershell
$env:DATABASE_URL = "postgresql+psycopg://ceres:...@localhost:5432/ceres_test"
py scripts/apply_migrations.py
py scripts/generate_demo_data.py --apply
Remove-Item Env:DATABASE_URL
```

Después, `TEST_DATABASE_URL=postgresql+psycopg://ceres:...@localhost:5432/ceres_test` en `.env` y `pytest -m postgres`.

---

## Estructura de directorios

```
Ceres/
├── apps/api/                       FastAPI
│   ├── app/
│   │   ├── api/v1/                 routers: farms, cells, predictions, observations, harvests, health
│   │   ├── core/
│   │   │   ├── prediction/         el motor: predict()
│   │   │   ├── state.py            state_at(): estado de una celda en una fecha
│   │   │   ├── provenance.py       vocabulario cerrado de procedencia
│   │   │   └── synthetic/          generadores: finca demo y La Cuadrícula
│   │   ├── domain/                 enums y aritmética del error (espejo de la vista SQL)
│   │   ├── models/                 SQLAlchemy
│   │   ├── schemas/                Pydantic v2
│   │   └── services/               lógica de aplicación; los routers no tocan SQL
│   └── tests/
│       ├── unit/                   sin base de datos
│       ├── integration/            SQLite en memoria, API completa
│       └── postgres/               PostgreSQL real, solo una base de test
├── apps/web/                       Next.js 16
│   ├── app/page.tsx                la única página que pide datos
│   ├── components/
│   │   ├── terrain/                React Three Fiber: malla, capas, cámara, capa accesible
│   │   ├── cell-inspector/         ficha de la celda: predicción, cosecha, histórico
│   │   ├── dashboard/              selectores de finca, lote, ciclo y momento
│   │   └── ui/                     primitivas
│   ├── lib/
│   │   ├── api/                    cliente HTTP, endpoints, useApiResource
│   │   ├── terrain/                coordenadas, elevación, procedencia
│   │   └── presentation/           valores → colores y formato
│   ├── stores/                     Zustand: solo estado de interfaz
│   └── tests/                      329 tests
├── database/
│   ├── migrations/                 0001 … 0007, fuente de verdad del esquema
│   └── seeds/                      seed de la finca demo
├── scripts/
│   ├── apply_migrations.py         aplica las migraciones pendientes
│   ├── generate_demo_data.py       finca demo reproducible (--apply)
│   ├── generate_cuadricula.py      La Cuadrícula (--apply, --reset, --manifest)
│   └── preview_predictions.py      predice las 400 celdas y muestra 3
└── docs/
    ├── architecture.md             capas y reglas invariantes
    ├── api.md                      contrato de los 16 endpoints
    ├── data-model.md               entidades y tablas
    ├── prediction-model.md         fórmulas y supuestos sintéticos
    ├── cuadricula.md               el escenario de validación y su manifiesto
    ├── elevation.md                de dónde sale el relieve
    ├── synthetic-data.md           la finca demo
    └── decisions.md                por qué el sistema es como es
```

---

## Estado del proyecto

| Fase | Contenido | Estado |
|---|---|---|
| 0–4 | Arquitectura, dominio, migraciones, motor, endpoints | ✅ |
| 4.5–4.6 | Verificación contra Supabase, paridad Python/SQL, idempotencia del seed | ✅ |
| 5–7 | Frontend, integración Next.js ↔ FastAPI, React Three Fiber | ✅ |
| 8 | Observaciones: API, procedencia y efecto en el motor | ✅ (registro solo por API) |
| 9 | Cosechas y error: API, vista `cell_performance`, «Predicción vs cosecha» | ✅ (registro solo por API) |
| 10 | Histórico predicción vs realidad en el inspector | ✅ |
| 11 | Eje temporal: `as_of`, `/timeline`, selector de momento | ✅ |
| 12 | La Cuadrícula: finca sintética de 4 ha para validar el ciclo completo | ✅ |
| 13 | Suite PostgreSQL contra una base local de test, con barrera anti-Supabase | ✅ |

**Lo que falta para que un agrónomo cierre el ciclo sin tocar la API:** formularios de observaciones y cosechas en la interfaz. Hoy se crean con `POST /observations` y `POST /harvests`; la interfaz las lee y las usa.

**937 tests**: 608 en el backend (unit, integración sobre SQLite y 42 contra PostgreSQL real) y 329 en el frontend. Cada fase se cerró con tests de mutación: se rompe el código a propósito y se comprueba que el test escrito para ello cae.

---

## Licencia

[AGPL-3.0](LICENSE).
