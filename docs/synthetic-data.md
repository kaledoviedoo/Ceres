# Datos sinteticos

> **DEMO / SYNTHETIC DATA.** La finca no existe. Los valores son plausibles pero
> inventados, y estan aqui para validar el sistema tecnicamente. Nada de esto es
> una medicion de campo.

> Estado: **implementado** (fase 2). Codigo en `app/core/synthetic/`.

## Reproducibilidad

```bash
py scripts/generate_demo_data.py
```

Seed fija (42). Misma seed -> mismo dataset, byte a byte.

Los identificadores son **UUID v5** derivados de un namespace fijo y una clave
legible (`"grid_cell:A:3:7"`). Consecuencia practica: reaplicar el seed
actualiza las filas existentes en vez de duplicarlas, y dos personas que
regeneran el dataset obtienen exactamente los mismos `cell_id`.

## Contenido

| Entidad | Cantidad |
|---|---|
| Organizacion | 1 |
| Usuarios | 2 (owner, agronomo) |
| Finca | 1, en Colombia |
| Lotes | 2 (Plot A, Plot B) de 20 x 20 |
| Cultivo | 1 (tomate chonto) |
| Ciclo de cultivo | 1, sobre Plot A |
| Celdas | 800 (400 por lote) |
| Observaciones | 24 |

Plot B tiene terreno generado pero **no** tiene ciclo de cultivo. Es intencional:
es exactamente el caso que justifica separar `CropCycle` de `Plot`, y deja un
lote libre para sembrar en una temporada futura.

La finca se ubica eligiendo una de cinco zonas agricolas reales de Colombia con
el generador sembrado: "aleatorio" segun el brief, pero reproducible. Con la
seed 42 sale Boyaca (Villa de Leyva).

## Por que el terreno no es ruido blanco

Un `rng.normal()` por celda produce una imagen de television sin senal: bonita
para un test de rangos, inutil para mirar un mapa. El terreno real tiene
estructura, y el mapa tiene que ensenarla.

La tecnica es **value noise**: se sortean valores en una malla gruesa y se
interpolan a la resolucion final con suavizado `3t^2 - 2t^3`. Celdas vecinas se
parecen; celdas lejanas no. Hay un test que lo comprueba
(`test_field_is_not_white_noise`).

Cada variable usa un stream independiente derivado de la seed, asi que anadir
una variable nueva no cambia los valores de las que ya existian.

## Patrones espaciales

Los gradientes que pide el brief, superpuestos al ruido suave:

```
        NORTE  (y = 19)
        mayor elevacion
             |
OESTE  ------+------  ESTE
foco de       |       mejor suelo
estres        |
sanitario     |
        SUR  (y = 0)
        menor elevacion
```

### Elevacion

```
elevation = 1180 m + 2.4 m * ny + 0.5 m * ruido
```

Una ladera andina suave: 2.4 m de desnivel en 20 m de lote.

### Pendiente — derivada, no sorteada

```
grad_y, grad_x = gradient(elevation, cell_size_m)
slope_deg      = degrees(arctan(hypot(grad_x, grad_y)))
```

Esta es la decision mas util del generador. Si la pendiente se sorteara aparte,
habria celdas planas en mitad de una ladera empinada: el terreno seria
internamente incoherente y el render 3D lo delataria de inmediato. Derivandola
de la elevacion, donde la superficie sube rapido la pendiente es alta. Gratis.

### Calidad de suelo — mejor al este

```
soil = 0.42 + 0.34 * nx + 0.10 * ruido      clip 0.05 .. 0.98
```

### Sanidad — foco de estres al oeste

Una campana gaussiana centrada en `(nx=0.18, ny=0.55)` con sigma 0.30:

```
stress = exp(-((nx-0.18)^2 + (ny-0.55)^2) / (2 * 0.30^2))
health = 0.92 - 0.34*stress - 0.18*slope_norm + 0.07*ruido    clip 0.05 .. 1.0
```

Produce una mancha de baja sanidad en el oeste, como un brote real que se
extiende desde un foco.

### Densidad de siembra

```
density = 2.5 * (1 + 0.10*ruido) - 0.35*slope_norm     clip 0.2 .. 2.875
```

Casi uniforme (se sembro toda la parcela igual), peor en pendiente.

### Multiplicador residual

```
base_yield_factor = 1.0 + 0.06 * ruido                 clip 0.80 .. 1.20
```

Captura variacion local que ninguna otra variable explica. En un sistema real
seria justo lo que un modelo de ML intentaria aprender.

Todos los parametros son ajustables via `TerrainProfile` en
`app/core/synthetic/field.py`.

## Observaciones sinteticas

Se generan sobre las celdas mas debiles de Plot A: es donde un agronomo
realmente miraria, asi que el mapa de observaciones tiene estructura en vez de
puntos al azar.

El tipo se deriva del estado de la celda con una regla explicita:

```
slope_deg >= 8        -> physical_damage
health < 0.35         -> disease
soil_quality < 0.50   -> water_stress
resto                 -> pest
(8% de las veces      -> other)
```

`severity` crece cuando la sanidad baja. No es agronomia real: es coherencia
interna, para que los datos de demo no se contradigan a si mismos.

## Uso

```bash
py scripts/generate_demo_data.py                 # escribe database/seeds/0001_demo_data.sql
py scripts/generate_demo_data.py --seed 7        # otra finca, igual de reproducible
py scripts/generate_demo_data.py --width 40 --height 40   # malla mas grande
py scripts/generate_demo_data.py --apply         # ademas lo ejecuta en DATABASE_URL
py scripts/generate_demo_data.py --stdout        # lo imprime sin escribir
```

El seed generado esta en `.gitignore`: se regenera, no se versiona.

## Relacionado

- [data-model.md](data-model.md)
- [prediction-model.md](prediction-model.md)
