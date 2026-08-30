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

La flecha va en un solo sentido. Una capa nunca llama hacia arriba.

### La regla que no se negocia

**El frontend 3D no calcula agricultura.** React Three Fiber hace hover, click,
seleccion, colores y camara. No hay `yield =`, `loss =` ni `risk =` en TypeScript.

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
│       │   │   ├── prediction/  motor de prediccion (fase 3)
│       │   │   └── synthetic/   generador de datos deterministas
│       │   ├── models/        mapeo de persistencia (SQLAlchemy)
│       │   ├── schemas/       contrato publico de la API (Pydantic)
│       │   ├── services/      consultas y casos de uso (fase 4)
│       │   ├── api/           routers HTTP (fase 4)
│       │   ├── config.py      settings desde .env
│       │   └── db.py          engine y sesiones
│       └── tests/
│           ├── unit/
│           └── integration/
├── database/
│   ├── migrations/        SQL versionado (fuente de verdad del esquema)
│   └── seeds/             seed de demo GENERADO, no editar a mano
├── scripts/               generacion de datos y runner de migraciones
└── docs/
```

`apps/web/` (Next.js) aparece en la fase 5. Todavia no existe: construirlo antes
de que el ciclo `cell -> prediction -> API -> response` funcione seria empezar
por el tejado.

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
