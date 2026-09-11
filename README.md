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
| 4.5 | Integracion y verificacion contra Supabase real | ✅ |
| 4.6 | Paridad Python/SQL, zona critica sintetica, idempotencia del seed | ✅ |
| 5 | Frontend 2D (grid 20x20) | ✅ |
| 6 | Integracion Next.js ↔ FastAPI | ✅ (hecha en la fase 5) |
| 7 | React Three Fiber | ✅ |
| 8 | Observaciones: API, procedencia y efecto en el motor (`state_at`) | ✅ (registro solo por API) |
| 9 | Cosechas y error de prediccion: API, vista `cell_performance`, «Prediccion vs cosecha» | ✅ (registro solo por API) |
| 10 | Historico prediccion vs realidad en el inspector | ✅ |
| 11 | Eje temporal: `as_of`, `/timeline`, selector de momento en la interfaz | ✅ |
| 12 | La Cuadricula: finca sintetica de 4 ha para validar el ciclo completo | ✅ |
| 13 | Suite PostgreSQL contra una base local de test, con barrera anti-Supabase | ✅ |

Las observaciones y las cosechas se crean por API (`POST /observations`,
`POST /harvests`); la interfaz las lee y las usa, pero todavia no tiene
formularios para registrarlas.

Lo que hay ahora: el ciclo completo funcionando de extremo a extremo, desde el
navegador hasta PostgreSQL, y con un eje temporal.

```
Next.js  ->  FastAPI  ->  Prediction Engine  ->  PostgreSQL (Supabase)
   |                                                |
   +-- finca -> lote -> ciclo -> momento (as_of) ---+
   |                                                |
   +-- click en una celda -> cell_id ---------------+
   |                                                |
   +-- Cell Inspector <- prediccion, cosecha, error +
```

El terreno se representa en 3D con React Three Fiber: un bloque de tierra cuyo
relieve sale de la elevacion de cada celda y cuya cara superior se pinta con las
metricas del motor. Camara orbital, hover, seleccion y jalon de celda.

**El eje temporal.** Cada prediccion guarda de que momento habla (`as_of`),
distinto de cuando se calculo (`created_at`). `GET /plots/{id}/timeline` lista
los momentos de los que CERES ya ha hablado sobre un lote; la interfaz los
ofrece como selector y pide el mapa y la ficha de ese instante. El estado de una
celda en una fecha se deriva de sus observaciones anteriores a esa fecha
(`state_at`), y el rendimiento cosechado no depende de desde cuando se mire:
lo que cambia es la prediccion con la que se compara, y por tanto el error.

**Dos fincas en la base de datos, las dos sinteticas** (40.400 celdas):

- *CERES Demo Farm*: 1 lote de 20 × 20 m, 400 celdas, 24 observaciones, sin
  predicciones ni cosechas. Es el seed reproducible de `generate_demo_data.py`.
- *La Cuadricula*: 4 lotes de 1 ha (100 × 100 celdas de 1 m2 cada uno), cuatro
  cultivos, 9.900 observaciones, 80.000 predicciones (dos momentos por celda) y
  40.000 cosechas. Construida como una simulacion agronomica coherente —una sola
  topografia, humedad latente, eventos localizados— para validar el ciclo
  completo. La verdad y la prediccion se generan por separado. Detalle en
  [cuadricula.md](docs/cuadricula.md).

**937 tests**: 608 en el backend (unit, integracion sobre SQLite en memoria y
42 contra PostgreSQL real) y 329 en el frontend.

**Verificado contra PostgreSQL real.** La suite `tests/postgres/` corre contra
una base local `ceres_test` con las migraciones y el seed aplicados: constraints,
trigger de inmutabilidad, vista `cell_performance`, paridad Python/SQL hasta el
ultimo decimal, los 16 endpoints y el ciclo prediccion → cosecha → error. Supabase
aloja los datos de la aplicacion y **no es un destino permitido** para esa suite.
La verificacion original de la fase 4.5 contra Supabase sigue documentada en
[api.md](docs/api.md#verificado-contra-supabase-fase-45).

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

Local con Docker:

```bash
docker compose up -d db
py scripts/apply_migrations.py
```

Supabase: copia la connection string de **Project Settings > Database** a
`DATABASE_URL` y cambia dos cosas — `postgresql+psycopg://` en vez de
`postgresql://`, y anade `?sslmode=require`. Despues, el mismo comando.

Los `.sql` de `database/migrations/` tambien se pueden pegar directamente en el
editor SQL de Supabase.

### 4. Datos de demo

```bash
py scripts/generate_demo_data.py --apply
```

Genera 1 finca, 1 lote, 400 celdas, 1 ciclo de cultivo y 24 observaciones.
Reaplicarlo es idempotente: converge al mismo estado, no lo acumula.

El dataset incluye una **zona critica sintetica** que produce celdas de riesgo
alto (134 `low`, 232 `medium`, 34 `high`). Es un escenario de prueba dibujado a
mano para ejercitar la visualizacion, no evidencia agronomica; ver
[synthetic-data.md](docs/synthetic-data.md#zona-critica--escenario-sintetico-de-estres).

### 5. Levantar la API

```bash
cd apps/api
uvicorn app.main:app --reload --port 8010
```

Swagger en http://localhost:8010/docs

### 5b. Levantar el frontend

```bash
cd apps/web
cp .env.local.example .env.local   # apunta a la API
npm install
npm run dev
```

CERES en http://localhost:3000

`NEXT_PUBLIC_API_BASE_URL` se hornea en el build: si cambias el puerto de la
API, hay que reconstruir, no basta con reiniciar.

### 6. Tests

```bash
cd apps/api
pytest                    # todo
pytest tests/unit         # sin base de datos
pytest tests/integration  # SQLite en memoria, no PostgreSQL
pytest -m postgres        # PostgreSQL real: solo contra una base de TEST
```

Los tests de `tests/postgres/` vacian tablas enteras (`TRUNCATE`). Solo corren
si `TEST_DATABASE_URL` apunta a una base que puedan destruir: un PostgreSQL
local con una base llamada `ceres_test` y las migraciones aplicadas. Si apunta
a la base de la aplicacion o a cualquier proyecto de Supabase se saltan con
`POSTGRES TEST DATABASE NOT SAFE`, y ninguna variable de entorno lo levanta
(`tests/postgres/guard.py`). Si ademas la base guarda un dataset, hace falta
`CERES_PG_TESTS_MAY_TRUNCATE=1` para autorizar la limpieza.

Para montarla una vez, con un PostgreSQL local (14+) y su superusuario:

```sql
CREATE ROLE ceres LOGIN PASSWORD '...';
CREATE DATABASE ceres_test OWNER ceres;
```

Despues, en `.env`, `TEST_DATABASE_URL=postgresql+psycopg://ceres:...@localhost:5432/ceres_test`,
y migraciones y seed apuntando a ella SOLO durante ese comando (`apply_migrations.py`
y `generate_demo_data.py` leen `DATABASE_URL`, asi que se les pasa como variable
de entorno de la sesion, sin tocar el `.env`):

```powershell
$env:DATABASE_URL = "postgresql+psycopg://ceres:...@localhost:5432/ceres_test"
py scripts/apply_migrations.py
py scripts/generate_demo_data.py --apply
Remove-Item Env:DATABASE_URL
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
| `cd apps/api && uvicorn app.main:app --reload --port 8010` | Levanta la API |
| `cd apps/api && pytest` | Tests del backend (608) |
| `cd apps/web && npm run dev` | Levanta el frontend en :3000 |
| `cd apps/web && npm test` | Tests del frontend (329) |
| `cd apps/web && npm run typecheck` | Comprueba los tipos |

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
│   ├── integration/    SQLite en memoria
│   └── postgres/       PostgreSQL real, solo una base de test (ver arriba)
├── database/
│   ├── migrations/     SQL versionado (fuente de verdad del esquema)
│   └── seeds/          generado, no versionado
├── scripts/
└── docs/
```

```
ceres/apps/web/
├── app/                page.tsx (unico sitio que pide datos) + layout + estilos
├── components/
│   ├── dashboard/      shell, selector finca->lote->ciclo, barra de estado
│   ├── terrain/        CellGrid (se sustituye por R3F en la fase 7)
│   ├── cell-inspector/ panel lateral y boton de prediccion
│   └── ui/             panel, spinner, error, vacio, badges
├── lib/
│   ├── api/            cliente HTTP, endpoints, errores
│   ├── types/          tipos derivados de los schemas de FastAPI
│   └── presentation/   valores -> colores y formato
├── stores/             Zustand: solo estado de interfaz
└── tests/              329 tests (vitest + testing-library)
```

---

## La regla que sostiene todo

**El frontend no calcula agricultura.**

El frontend hace hover, click, seleccion, colores y camara. Toda formula
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

Un agronomo entra al dashboard, elige finca → lote → ciclo → momento, ve el
lote en 3D, hace click en una celda, y CERES le devuelve rendimiento proyectado,
cajas, perdida estimada, riesgo y los factores que lo explican. Despues registra
una observacion, mas tarde la cosecha real, y CERES le dice cuanto se equivoco
en cada momento del que hablo.

Eso funciona de extremo a extremo sobre La Cuadricula. Lo que falta para que un
agronomo lo haga sin tocar la API es el formulario de observaciones y cosechas.
