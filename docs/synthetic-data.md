# Datos sinteticos — finca demo

> **DEMO / SYNTHETIC DATA.** La finca no existe. Los valores son plausibles pero
> inventados, y estan aqui para validar el sistema tecnicamente. Nada de esto es
> una medicion de campo.

> Estado: **implementado** (fase 2). Codigo en `app/core/synthetic/field.py` y
> `app/core/synthetic/demo.py`.

> **Este documento describe la finca DEMO, no la unica del despliegue.** Existe
> un segundo escenario sintetico, **La Cuadricula**, mucho mas grande y con eje
> temporal: ver [`cuadricula.md`](cuadricula.md). Los dos conviven en la misma
> base de datos y no comparten ni namespace de UUID ni prefijo de lote.

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
| Lotes | 1 (Plot A) de 20 x 20 |
| Cultivo | 1 (tomate chonto) |
| Ciclo de cultivo | 1, sobre Plot A |
| Celdas | 400 |
| Observaciones | 24 |
| Zona critica | 1 foco sintetico por lote (ver abajo) |

Hubo un Plot B sin ciclo de cultivo, pensado para demostrar que `CropCycle` y
`Plot` son entidades separadas. Se retiro: en la interfaz se traducia en un
selector con una opcion que al pulsarla no mostraba nada, y eso no se lee como
un modelo de datos bien pensado sino como un fallo. La separacion sigue
demostrada donde corresponde --esquema, claves foraneas y tests--.

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

### Zona critica — ESCENARIO SINTETICO DE ESTRES

> **Esto no es agronomia.** Es un caso de prueba dibujado a mano para que el
> dataset produzca celdas de `risk_level = high` y la visualizacion pueda
> ejercitar los tres niveles de riesgo. No representa un fenomeno observado, ni
> una zona de una finca real, ni evidencia de nada.

Hasta la fase 4.6 el dataset producia 136 celdas `low`, 264 `medium` y **ninguna
`high`**: la vista de riesgo del frontend solo habria podido mostrar dos de los
tres colores. Habia dos formas de arreglarlo y solo una es honesta.

La deshonesta: bajar el umbral de `high` o subir el peso de la sanidad hasta que
salieran celdas rojas. Eso es cambiar el modelo para que los datos queden
bonitos, y de paso invalida cualquier comparacion futura.

La que se hizo: dejar el modelo intacto y anadir al **generador** un foco de
deterioro extremo.

```
health = ... - 0.75 * critical
soil   = ... - 0.35 * critical
elev   = ... - 0.60 m * critical

critical = campana gaussiana en (nx=0.12, ny=0.72), sigma 0.10
```

Tres decisiones de diseno:

1. **Es una campana, no un recorte.** Las celdas del nucleo son `high`, las de
   alrededor `medium` y despues `low`. La transicion es continua y el mapa se lee
   como un foco que se agrava, no como un parche pegado encima. Hay un test que
   comprueba que el anillo que rodea al foco es `medium`.
2. **Esta dentro del area de estres del oeste**, no en un punto cualquiera: la
   zona peor de la finca se pone todavia peor, que es como se comporta un brote.
3. **Tambien hunde el terreno.** Una hondonada de 60 cm, que ademas genera
   pendiente en el borde. Importa para la fase 7: el terreno 3D se deforma con la
   elevacion, y una zona critica plana se veria como una mancha pintada.

Resultado, con la seed 42, sobre Plot A:

```
norte
  oooooooooooo........
  oooooooooooo........      . low      134 celdas
  o####ooooooo........      o medium   232 celdas
  ######oooooo........      # high      34 celdas
  #######oooooo.......
  #######oooooo.......      un solo foco contiguo,
  ######ooooooo.oo....      x en [0,6], y en [12,17]
  o####ooooooo........
  oooooooooooo........
  ...
sur    oeste        este
```

Para desactivarla basta con poner a cero las tres penalizaciones de
`TerrainProfile`. Un test hace exactamente eso y comprueba que sin la zona no
queda ninguna celda `high`: es la prueba de que el `high` viene del dataset y no
de haber tocado el modelo.

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

### Reaplicar el seed es idempotente

El archivo empieza borrando las filas que el propio seed produjo en
generaciones anteriores y que ya no produce, antes de insertar las nuevas.

Hace falta porque los `ON CONFLICT DO UPDATE` mantienen al dia lo que sigue
existiendo pero no borran lo que dejo de existir. El id de una observacion sale
de `(cell_code, orden)`, y que celdas se observan depende de cuales son las mas
debiles: al introducir la zona critica cambio la seleccion y la base acabo con
48 observaciones en vez de 24. La limpieza esta acotada a las filas con autor
del seed, asi que las observaciones creadas por la API no se tocan.

## Relacionado

- [data-model.md](data-model.md)
- [prediction-model.md](prediction-model.md)
