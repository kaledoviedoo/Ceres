# Arquitectura

> DEMO / SYNTHETIC DATA — CERES es un prototipo. Estima rendimiento con un
> modelo determinista sintetico; no es una prediccion agronomica validada.

## Las capas y quien puede hablar con quien

```
FRONTEND (Next.js)        representa informacion
      |
      v  REST + JSON
API (FastAPI)             traduce HTTP <-> dominio
      |
      v
DOMAIN / CORE (Python)    toda la logica agricola
      |
      v
DATABASE (PostgreSQL)     estado e historia
```

La misma aplicacion corre contra dos motores segun el entorno:

```
Desarrollo / CI rapido        Entorno real
        |                          |
        v                          v
  SQLite en memoria          Supabase PostgreSQL 17
  (solo para tests)          (desarrollo y produccion)
```

SQLite no es un motor soportado del producto: existe unicamente para que los
tests de integracion corran en 2 segundos sin red ni credenciales. Todo lo
especifico de PostgreSQL —trigger de inmutabilidad, vista `cell_performance`,
tipos nativos, RLS— se verifica en `tests/postgres/` contra Supabase real.

La flecha va en un solo sentido. Una capa nunca llama hacia arriba.

### La regla que no se negocia

**El frontend 3D no calcula agricultura.** React Three Fiber hace hover, click,
seleccion, colores y camara. No hay `yield =`, `loss =` ni `risk =` en
TypeScript, y hay un grep en la verificacion de cada fase que lo comprueba.

`lib/terrain/geometry.ts` es la unica matematica del frontend y es puramente de
presentacion: convierte coordenadas de malla y metros sobre el nivel del mar en
unidades de mundo 3D. La exageracion vertical decide cuantos pixeles ocupa un
desnivel, no cuanto mide.

Motivo: si la formula vive en dos sitios, se separan. Y una demo bonita cuya
matematica esta escondida en un componente React no es un producto, es una
maqueta.

El backend devuelve **valores**; el frontend decide como pintarlos. Por eso no
hay colores agricolas en Python: `risk_score = 0.72` sale de la API, y que eso
se pinte rojo es una decision de la UI.

## Mapa de carpetas

```
ceres/
├── apps/
│   └── api/
│       ├── app/
│       │   ├── domain/        vocabulario compartido (enums, umbrales)
│       │   ├── core/
│       │   │   ├── prediction/  motor de prediccion (implementado)
│       │   │   └── synthetic/   generador de datos deterministas
│       │   ├── models/        mapeo de persistencia (SQLAlchemy)
│       │   ├── schemas/       contrato publico de la API (Pydantic)
│       │   ├── services/      consultas y casos de uso
│       │   ├── api/v1/        routers HTTP (finos)
│       │   ├── main.py        la app FastAPI
│       │   ├── config.py      settings desde .env
│       │   └── db.py          engine y sesiones
│       └── tests/
│           ├── unit/          sin base de datos
│           ├── integration/   SQLite en memoria (rapido, sin credenciales)
│           └── postgres/      Supabase real (se salta sin TEST_DATABASE_URL)
├── database/
│   ├── migrations/        SQL versionado (fuente de verdad del esquema)
│   └── seeds/             seed de demo GENERADO, no editar a mano
├── scripts/               generacion de datos y runner de migraciones
└── docs/
```

```
ceres/apps/web/
├── app/page.tsx        el UNICO sitio que pide datos a la API
├── components/
│   ├── dashboard/      franja superior, selector de lote
│   ├── terrain/        TerrainView -> TerrainCanvas (3D) | CellGrid (2D)
│   ├── cell-inspector/ panel lateral
│   └── ui/             primitivas
├── lib/
│   ├── api/            cliente HTTP, endpoints, errores, configuracion
│   ├── types/          espejo de los schemas Pydantic
│   ├── terrain/        geometria de la escena y paleta 3D
│   └── presentation/   valores -> colores, formato
├── stores/             Zustand: SOLO estado de interfaz
└── tests/
```

### El punto de sustitucion

`TerrainView` decide que representacion se monta y traduce store <-> props:

```
TerrainView
   |-- terrainMode "3d" --> TerrainCanvas   (React Three Fiber)
   `-- terrainMode "2d" --> CellGrid        (malla plana)
```

Las dos cumplen el mismo contrato estrecho: reciben celdas ya calculadas y
emiten `cell_id`. Ninguna importa `lib/api/` ni `stores/`, y por eso `page.tsx`,
el Cell Inspector y el cliente de API no se enteran de cual esta montada.

La correspondencia se mantiene por `cell_id`, no por posicion: el raycasting de
la escena 3D devuelve ese mismo identificador que devolvia un click en 2D.

### Como se representa el terreno

Dos mallas instanciadas —el bloque de suelo y la losa analitica encima—, dos
llamadas de dibujo para 400 celdas. La escena se dibuja bajo demanda
(`frameloop="demand"`): parada no consume nada.

El hover no pasa por React: vive en referencias y escribe dos colores de
instancia. Medido, 0,007 ms por movimiento del raton.

Un canvas de WebGL no es accesible, asi que la malla existe tambien como DOM
real —`AccessibleCellLayer`, invisible y sin capturar el puntero— con roving
tabindex y flechas.

Tres reglas sostienen esa sustituibilidad:

1. **Los datos no viven en el store.** `page.tsx` los pide y bajan por props. Un
   store con las 400 celdas dentro seria una cache que nadie invalida.
2. **El store solo guarda identificadores**: que finca, que lote, que ciclo, que
   celda, que modo de vista. La escena 3D leera y escribira exactamente los
   mismos.
3. **Ninguna formula agricola en TypeScript.** `lib/presentation/risk.ts` mapea
   `risk_level` a un color; eso es todo. El backend manda `"high"` y el frontend
   decide que se pinta rojo.

## Las cuatro representaciones de una celda

Hay cuatro formas distintas de un mismo concepto, y cada una tiene un motivo:

| Representacion | Donde | Para que |
|---|---|---|
| Tabla `grid_cells` | `database/migrations/` | estado persistido |
| `GridCell` (SQLAlchemy) | `app/models/` | leer y escribir esa tabla |
| `CellRead` / `CellSummary` (Pydantic) | `app/schemas/` | contrato con el frontend |
| `PredictionInput` (dataclass) | `app/core/prediction/` | entrada del motor, sin dependencias |

La cuarta es la importante: el motor recibe **valores planos**, no un modelo de
SQLAlchemy. Eso es lo que permite testearlo sin base de datos, ejecutarlo desde
un notebook y sustituirlo por un modelo estadistico sin tocar nada mas.

## Reglas invariantes del sistema

1. **Las predicciones son inmutables.** Cada ejecucion del motor inserta una fila
   nueva con su `model_version`. Reforzado con un trigger en la base de datos
   (`0002_prediction_immutability.sql`), no solo por convencion.
2. **Un cultivo no cuelga de un lote.** Cuelga de un `CropCycle`, porque el mismo
   lote siembra cosas distintas en temporadas distintas.
3. **La identidad de una celda es su `id`**, no su par `(x, y)`. `cell_code`
   ("A-00123") existe para humanos y para la UI.
4. **Cargar la malla es una sola peticion.** `GET /plots/{id}/cells` devuelve las
   400 celdas. Nunca una peticion por celda.
5. **Nada de datos sinteticos hardcodeados en componentes.** Todo dato de demo
   sale del generador determinista.
6. **El motor no importa nada de infraestructura.** Ni FastAPI, ni SQLAlchemy,
   ni red. Recibe protocolos estructurales (`CellState`, `CropSpec`), asi que un
   `GridCell` real sirve y un dataclass de tres lineas tambien.
7. **Ninguna consulta SQL fuera de `services/`.** Los routers validan, llaman a
   un servicio y devuelven un schema. Nada mas.
8. **Los servicios no conocen HTTP.** Lanzan `NotFoundError` y `ConflictError`;
   la traduccion a 404 y 409 ocurre en un unico sitio
   (`api/exception_handlers.py`). Asi los mismos servicios valen para un
   endpoint, un script o un worker.
9. **El servidor es la fuente de verdad agricola.** El cliente solo manda
   identificadores. `PredictionCreate` declara `extra="forbid"`, asi que enviar
   `soil_quality` o `projected_yield_kg` se rechaza con 422.
10. **Colorear el mapa no escribe en el historico.** `GET /plots/{id}/overview`
    ejecuta el motor sobre las 400 celdas y tira el resultado; guardar una
    prediccion es un acto deliberado del usuario sobre una celda concreta.

## Que deja preparado esta arquitectura (sin implementarlo)

- **PostGIS**: `farms.latitude/longitude` y `grid_cells.centroid_*` son columnas
  planas hoy; migran a `geography(Point, 4326)` sin tocar el modelo conceptual.
- **ML**: el motor tiene un contrato de entrada/salida cerrado. Cambiar
  `rule-based-v0.1` por `gbm-v1` no cambia la API ni el frontend, y las
  predicciones antiguas siguen diciendo con que modelo se hicieron.
- **Fuentes externas** (satelite, clima, sensores): entran como campos nuevos en
  `grid_cells` o como tablas de series temporales que apuntan a `cell_id`.

## Relacionado

- [data-model.md](data-model.md)
- [prediction-model.md](prediction-model.md)
- [decisions.md](decisions.md)
