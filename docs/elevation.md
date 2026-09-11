# Elevacion, coordenadas y procedencia

> **DEMO / SYNTHETIC DATA.** La elevacion que CERES dibuja hoy no se midio. La
> genera `app/core/synthetic/field.py`. Este documento existe para que eso este
> escrito en algun sitio que no sea un comentario.

Tres cosas: como esta montada la rama de la elevacion, por donde pasa una
coordenada desde la celda hasta el pixel, y que tendria que traer una fuente
real para sustituir a la actual sin rehacer nada.

---

## 1 · La rama de la geometria

```
ElevationSource ──> ElevationField ──> TerrainGeometry ──> Three.js
   (de donde          (muestreo,          (malla, faldon,
    salen los          pendiente,          drapeado)
    metros)            sombreado,
                       curvas)
```

Cada eslabon esta en un modulo y solo conoce al anterior:

| Eslabon | Fichero | Que sabe |
|---|---|---|
| `ElevationSource` | `lib/terrain/elevation.ts` | metros en el centro de (x, y), extremos, procedencia |
| `ElevationField` | `lib/terrain/elevation.ts` | muestreo continuo, `heightAt`, `hillshade`, `contours` |
| `buildTerrainMesh` / `buildSkirt` / `drapeOnTerrain` | `lib/terrain/geometry.ts` | vertices |

**La separacion esta en la firma, no en la disciplina.** `buildTerrainMesh`
acepta un `ElevationField` y nada mas. Una capa analitica no puede llamarla
porque `paint(cells, gridWidth, gridHeight)` no recibe un campo: no tiene forma
de conseguir uno. Los tests de `terrain-layers.test.ts` (bloques A–G) y
`elevation-source.test.ts` convierten esa imposibilidad de tipos en una
comprobacion ejecutada.

### La exageracion vertical es presentacion, no dato

`VERTICAL_EXAGGERATION = 2.2` multiplica **metros reales** para producir unidades
de mundo. No toca ningun numero que salga por la interfaz: el inspector lee
`elevation_m` de la celda.

### Que hay de verdad en la elevacion actual

Descomponiendo el campo de 400 valores en componentes principales:

| Componentes | Varianza reconstruida |
|---|---|
| 1 | 90,02 % |
| 3 | 98,78 % |
| 4 | **99,99 %** |

Un terreno con 400 medidas independientes necesitaria del orden de 20
componentes para llegar al 99 %. Este necesita cuatro, porque el generador lo
construye como constante + rampa sur-norte + ruido de una reticula 4x4
interpolado + una gaussiana: unos 19 parametros.

    Resolucion NOMINAL    1 m   (separacion entre muestras almacenadas)
    Resolucion EFECTIVA   5 m   (escala a la que hay variacion real)

Subdividir mas la malla anade triangulos, no informacion.

### La procedencia es un supuesto explicito

La API **no** declara de donde sale `elevation_m`: no hay ningun campo de
procedencia en `/plots/{id}/cells`. `ASSUMED_PROVENANCE` es lo que el frontend
afirma mientras el backend calle, y lo afirma en la direccion prudente. Se pasa
por argumento a `gridElevationSource`, asi que el dia que el backend lo declare
no hay que tocar ningun componente.

**Deuda registrada:** que el frontend tenga que suponerlo es una debilidad del
contrato, no del componente.

---

## 2 · Mapa de coordenadas

Cinco sistemas. Ninguna etapa adivina el de la anterior.

```
  celda (x, y)                    enteros, x=0 oeste, y=0 sur
        |
        |  cell_centroid()  [backend]
        v
  (lat, lon)                      EPSG:4326, aprox. de placa plana
        |
        |  gridToWorld()    [lib/terrain/coords.ts]
        v
  mundo (X, Y, Z)                 unidades Three.js, 1 unidad = 1 m
        |
        |  Vector3.project(camera)
        v
  NDC (x, y, z)                   [-1, 1]
        |
        v
  pixeles del lienzo
```

| Etapa | Sistema | Unidad | Quien la produce |
|---|---|---|---|
| Matriz | indices de malla | celdas | backend (`x`, `y`) |
| Geografica | EPSG:4326 | grados | backend (`centroid_latitude/longitude`) |
| Mundo | local, origen en el centro del lote | metros | `gridToWorld` |
| Altura | +Y del mundo | metros x 2,2 | `ElevationField.heightAt` |
| Pantalla | NDC y luego pixeles | — | camara + `size` |

### Convenio de ejes

```
x del dato  -> +X del mundo    (0 = oeste)
y del dato  -> -Z del mundo    (0 = sur; el norte queda hacia -Z)
elevacion   -> +Y del mundo
```

La inversion de Z existe porque la camara de Three.js mira por defecto hacia -Z:
con este convenio la vista inicial deja el norte al fondo y el oeste a la
izquierda, igual que en la malla 2D y que en un mapa.

### El centroide geografico

Lo calcula el backend desde la esquina suroeste del lote, con aproximacion de
placa plana (`METERS_PER_DEGREE_LATITUDE = 111 320`, longitud escalada por el
coseno de la latitud). Valida a escala de decenas de metros. **No hay PostGIS ni
proyeccion real todavia**, y por eso el frontend no recalcula coordenadas
geograficas: las lee.

### La regla de la seleccion

```
raycast -> posicion espacial -> coordenada del lote -> celda
```

Nunca:

```
raycast -> color -> indice visual -> celda
```

Comprobado: `TerrainSurface.cellAt(worldX, worldZ)` llama a `worldToGrid` y
redondea al indice de malla. No hay `instanceId`, ni lectura de pixel, ni
busqueda por color en ninguna de las dos vistas. Cuando entre un DEM cuya malla
no coincida con la agricola, esto es lo unico que cambia: la posicion pasara por
latitud y longitud en vez de por indice.

---

## 3 · Contrato para una fuente real

Los tipos estan en `lib/terrain/dem.ts`. **No hay implementacion, y es
deliberado**: no existe todavia un GeoTIFF ni una nube de puntos contra la que
validar un lector, y escribir uno a ciegas produce codigo que parece funcionar
porque nadie lo ha ejecutado con un fichero de verdad.

Una fuente real tiene que declarar:

| Campo | Por que no es opcional |
|---|---|
| `crs` | Sin el, un UTM en metros se lee como grados |
| `verticalDatum` | Elipsoidal vs ortometrico difieren decenas de metros |
| `extent` | Decide si el raster cubre el lote o deja borde sin dato |
| `resolutionM` | Rara vez es igual en los dos ejes |
| `noData` | El -9999 tipico entra en la malla como una fosa de 10 km |
| `units` | Un DEM en pies existe y arruina la escala |
| `minMeters` / `maxMeters` | Fijan la rampa y el faldon |
| `sampling` | `nearest` devuelve una medicion; `bilinear` una estimacion |
| `provenance` | Es lo que la interfaz muestra |

Y hay que resolver el puente entre las dos mallas:

```
celda (x, y)
  -> centroide (lat, lon)          ya lo sirve la API, EPSG:4326
  -> (X, Y) en el CRS del raster   proyeccion
  -> (col, fila)                   transformacion afin del GeoTIFF
  -> metros                        muestreo, segun `sampling`
```

**CERES ya tiene por donde empezar**: el anclaje geografico de la malla no hay
que inventarlo, viaja con cada celda.

### Comprobaciones antes de aceptar un raster

`ElevationSourceCheck` las enumera: cobertura, muestras por celda, huecos y
coincidencia de datums. Son los cuatro modos en que un DEM real estropea un
terreno **sin dar ningun error**.

### Lo que NO cambiaria al entrar el DEM

Comprobado ejecutando, no razonando (`tests/elevation-source.test.ts`): con una
fuente que tiene su propia rejilla de 5x5 para 20x20 celdas y se declara medida,
la geometria cambia y **las seis capas analiticas pintan byte a byte lo mismo**.
No cambian las capas, la seleccion, el inspector, la camara, las estadisticas ni
la visualizacion.

---

## 4 · Pendiente: por que tener el campo no basta

`slope_deg` llega 400/400, entre 1,09 y 21,14 grados. Sigue sin ser capa, por
tres razones encadenadas:

1. **No se midio, se derivo.** `np.gradient` sobre la elevacion sintetica.
   Hereda todo lo que le pase a esa elevacion.
2. **La derivada amplifica el error de la fuente.** Una diferencia finita a 1 m
   sobre un campo que solo varia cada 5 m describe el interpolador, no el
   terreno.
3. **El rango es artefacto.** Los 21 grados del extremo alto salen del borde de
   la hondonada sintetica —0,6 m de caida en un nucleo de dos celdas— que existe
   para que el dataset produzca celdas de riesgo alto.

Con un DEM real las tres desaparecen a la vez y la capa se activa rellenando su
entrada con `metricLayer`.

---

## 5 · Circularidad entre capas

El motor calcula el riesgo asi (`app/core/prediction/risk.py`):

```
risk_score = 0,45*(1-sanidad) + 0,30*(1-suelo) + 0,25*pendiente_norm
```

Y la perdida y el rendimiento salen de esos mismos tres campos con otros pesos.

**Consecuencia para la interfaz:** la coincidencia espacial entre cualquier capa
y la zona de riesgo alto no es un hallazgo, es la formula vista desde el mapa.
Cada capa lo declara en su ficha (`caution`) y el panel de reparto lo muestra
junto a la cifra de coincidencia. La cifra sigue sirviendo para saber **donde** y
**cuanto**; no para concluir una relacion observada en el campo.

---

## 6 · Ficha de las seis capas

| Capa | Pregunta | Fuente | Unidad | Bajo → Alto | Escala | Origen |
|---|---|---|---|---|---|---|
| Terreno | Que forma tiene el campo | `elevation_m` | m s.n.m. | parte baja → parte alta | lote | entrada |
| Riesgo | Donde estima el motor mas riesgo | `risk_level` / `risk_score` | indice 0–1 | bajo → alto | **motor** | derivado |
| Rendimiento | Cuanto se espera cosechar | `projected_yield_kg` | kg/celda | menos → mas | lote | derivado |
| Perdida | Que parte se estima perder | `estimated_loss_percentage` | % | poco → mucho | lote | derivado |
| Suelo | Donde esta el suelo mas pobre | `soil_quality` | indice 0–1 | peor → mejor | lote | entrada |
| Sanidad | Donde esta el cultivo mas castigado | `health_factor` | indice 0–1 | peor → mejor | lote | entrada |

**Escala «lote»** significa que la rampa recorre el minimo y el maximo de esa
parcela: dos lotes con el mismo color no tienen el mismo valor. Solo el riesgo
usa una clasificacion del motor, igual en todas partes.

Las seis fichas viven en `lib/terrain/layers.ts` y las fija
`terrain-layers.test.ts`, bloque G: anadir una capa no compila sin contestarlas.

### Lo que deliberadamente no es capa

`plant_density` y `base_yield_factor` llegan 400/400 y no estan en el catalogo.
La densidad de siembra es una decision previa y casi uniforme —2,5 plantas/m2
+-10 %—, y el factor residual es por definicion lo que el modelo **no** explica:
pintarlo invitaria a buscarle un sentido espacial que no tiene. Los dos siguen
en el inspector, que es su sitio, como ficha de una celda concreta.
