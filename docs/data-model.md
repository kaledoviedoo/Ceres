# Modelo de datos

> DEMO / SYNTHETIC DATA — los valores del dataset de demo son ficticios.

## Relaciones

```
Organization
    ├── User
    ├── Crop  (catalogo: tomate, cafe, ...)
    └── Farm
          └── Plot                 (define la malla: 20 x 20 x 1 m)
                ├── GridCell       (~1 m2, estado estatico del terreno)
                └── CropCycle      (que se siembra aqui, esta temporada)

GridCell + CropCycle
    ├── Prediction    (inmutable, versionada)
    ├── Observation   (lo que ve un humano)
    └── Harvest       (el resultado real)
```

Fijate en el ultimo bloque: `Prediction`, `Observation` y `Harvest` apuntan **a
la vez** a una celda y a un ciclo de cultivo. Esa doble referencia es lo que
permite comparar prediccion contra realidad en el contexto correcto: 18.4 kg
predichos para la celda A-00123 *en la temporada 2026-A*.

## Por que CropCycle existe

Es la decision menos obvia del modelo. Lo intuitivo seria `Plot.crop_id`.

El problema: un lote siembra tomate en 2026 y pimenton en 2027. Con `crop_id` en
el lote, al empezar la temporada nueva habria que sobrescribir el campo, y todas
las predicciones y cosechas historicas quedarian colgando de un cultivo que ya
no es el que se sembro cuando se registraron.

`CropCycle` corta ese nudo:

```
Plot A --> CropCycle "Tomate 2026-A" --> Tomato
Plot A --> CropCycle "Pimenton 2027"  --> Pepper
```

El lote es permanente. El ciclo es temporal. La historia sobrevive.

## Tablas

Todas las tablas tienen `id uuid` y `created_at timestamptz`.

### `organizations`
Tenant raiz. `slug` unico.

### `users`
`role`: `owner` | `agronomist` | `viewer`. Permisos finos y RLS quedan fuera del MVP.

### `farms`
`latitude` / `longitude` = centroide aproximado. Columnas planas hasta que entre PostGIS.

### `plots`
Define la malla, no el cultivo.

| Campo | Nota |
|---|---|
| `code` | prefijo del `cell_code` (`A` -> `A-00001`) |
| `grid_width`, `grid_height` | 20 x 20 en el MVP |
| `cell_size_m` | 1.0 => cada celda es ~1 m2 |
| `origin_latitude`, `origin_longitude` | esquina **suroeste** de la malla |

**Convencion de ejes:** `x = 0` es oeste, `y = 0` es sur. `x` crece al este,
`y` crece al norte. Esto importa: el generador sintetico y el frontend 3D tienen
que estar de acuerdo o el mapa sale reflejado.

### `crops`
Catalogo reusable con los parametros que consume el motor:

| Campo | Unidad | Para que |
|---|---|---|
| `box_capacity_kg` | kg | calcular `projected_boxes` |
| `base_yield_kg_per_m2` | kg/m2 | punto de partida del motor |
| `optimal_plant_density_per_m2` | plantas/m2 | convertir densidad real en factor |
| `cycle_days` | dias | informativo |

### `crop_cycles`
`status`: `planned` | `active` | `harvested` | `closed`.

### `grid_cells`
La unidad atomica del Digital Twin. Guarda **estado estatico**, nunca resultados.

| Campo | Unidad | Rango |
|---|---|---|
| `elevation_m` | msnm | — |
| `slope_deg` | grados | 0..90 |
| `soil_quality` | indice | 0 pobre .. 1 optimo |
| `plant_density` | plantas/m2 | >= 0 |
| `health_factor` | indice | 0 muerto .. 1 sano |
| `base_yield_factor` | multiplicador | > 0, centrado en 1.0 |

Restricciones: `UNIQUE (plot_id, x, y)` y `UNIQUE (plot_id, cell_code)`.
La identidad canonica es `id`; `cell_code` es la etiqueta legible.

### `predictions`
**Inmutable.** Un trigger rechaza `UPDATE` y `DELETE`.

Guarda `model_version`, los resultados, y dos campos `jsonb`:
- `factors` — el desglose explicable (`{"soil_factor": 1.1, ...}`)
- `inputs` — copia de las entradas, para poder reproducir la prediccion aunque
  la celda cambie despues

Indice principal: `(cell_id, created_at DESC)`, que es exactamente la consulta
del historial de una celda.

### `observations`
`type`: `pest` | `disease` | `water_stress` | `physical_damage` | `other`.
`severity` en 0..1. `crop_cycle_id` es opcional: puede haber dano fisico del
terreno entre temporadas.

### `harvests`
El ground truth. `actual_yield_kg`, `actual_boxes`, `harvested_at`.

### Vista `cell_performance`
Prediccion emparejada con su cosecha, con `absolute_error_kg` y
`percentage_error` ya calculados. La comparacion se define **una sola vez**, en
SQL, en lugar de repetirse en backend y frontend.

`percentage_error` es `NULL` cuando no hay cosecha **o cuando el rendimiento real
es 0**: dividir por cero no da un porcentaje grande, no da nada, y es mejor
decirlo que inventarse un numero.

## Ciclo del Digital Twin

```
GridCell (estado)
    -> Prediction    (que creemos que va a pasar)
    -> Observation   (que ve el agronomo por el camino)
    -> Harvest       (que paso de verdad)
    -> cell_performance  (cuanto nos equivocamos)
```

Ese ultimo paso es el producto. Lo demas es infraestructura para llegar a el.

## Relacionado

- [architecture.md](architecture.md)
- [prediction-model.md](prediction-model.md)
- [decisions.md](decisions.md)
