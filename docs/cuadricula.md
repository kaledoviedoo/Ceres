# La Cuadricula — escenario sintetico de validacion

> **La Cuadricula NO representa una finca real ni datos de un cliente. Es un
> escenario sintetico construido para validar CERES.**
>
> Ninguna de sus 40.000 celdas, 9.900 observaciones ni 40.000 cosechas
> corresponde a una medicion de campo. No hay propietario, tecnico, agricultor,
> sensor ni estacion meteorologica detras de ningun numero.

> Estado: **implementado**. Codigo en `app/core/synthetic/cuadricula.py`
> (el campo) y `cuadricula_dataset.py` (las filas). Carga con
> `scripts/generate_cuadricula.py`.

Es un **escenario agronomico sintetico plausible**: las variables se relacionan
entre si como lo harian en un campo, y esa coherencia interna es lo que lo hace
util para probar el producto. No es una representacion de un campo concreto.

---

## Que hay

| | |
|---|---|
| Ubicacion simulada | Monquira, Villa de Leyva, Boyaca, Colombia |
| Centro | 5.6375, -73.5264 |
| Lotes | 4, de 1 ha cada uno |
| Malla por lote | 100 x 100 celdas |
| Celda | 1 m2 **nominal** |
| `grid_cells` | 40.000 |
| `observations` | 9.900 — todas `synthetic`, `created_by = NULL` |
| `predictions` | 80.000 (dos momentos por celda) |
| `harvests` | 40.000 |
| `measured` | **0** |
| Semilla maestra | **2026** |

| Lote | Cultivo | Objetivo | Siembra | Cosecha |
|---|---|---|---|---|
| **P** | Papa Diacol Capiro | 33.500 kg/ha | 2026-03-15 | 2026-08-20 |
| **M** | Maiz amarillo | 7.500 kg/ha | 2026-04-10 | 2026-09-15 |
| **Z** | Zanahoria | 46.200 kg/ha | 2026-05-01 | 2026-08-30 |
| **R** | Remolacha | 27.800 kg/ha | 2026-04-20 | 2026-08-10 |

Los prefijos P/M/Z/R no son cosmeticos: la finca demo usa `A`, y varios tests
buscan `cell_code = 'A-00240'` sin filtrar por lote. Reutilizar el prefijo
devolveria dos filas.

---

## RESOLUCION NOMINAL vs RESOLUCION EFECTIVA

Es la distincion mas facil de leer mal y la que mas importa.

```
nominal    1 m      donde estan las muestras: una por celda
efectiva   ~33 m    a que escala varia el campo DE VERDAD
```

**40.000 celdas no son 40.000 mediciones.** Son 40.000 unidades de
representacion sobre un campo sintetico espacialmente correlacionado cuyo
detalle real esta a decenas de metros.

La cifra de 33 m no se estima a ojo: sale de descomponer el campo de elevacion
en valores singulares. Tres componentes reconstruyen mas del 99,9 % de un lote
de 100 m de lado, o sea unos 100/3 m de detalle. Se declara el peor caso de los
cuatro lotes. Lo vuelve a medir `tests/unit/test_provenance.py`, asi que si
alguien cambia el generador y el campo gana o pierde estructura, la afirmacion
deja de poder hacerse.

La API lo dice en `provenance.dataset.representation` de
`GET /plots/{id}/cells`, y la interfaz lo repite bajo el bloque de relieve.

---

## Como se construye

### Una sola topografia

Se genera **una superficie de 220 x 220 m** y los cuatro lotes se recortan de
ella, con una calle de 20 m entre medias. Los bordes de lotes vecinos casan
porque es el mismo terreno, no cuatro maquetas.

La superficie se AJUSTA a las celdas de referencia del escenario en vez de
generarse y sobrescribirse. El ajuste minimiza a la vez tres cosas: distancia a
las 7 cotas declaradas, distancia a las 7 pendientes declaradas, y energia de
flexion. Sin el tercer termino el ajuste clava los catorce numeros y devuelve
una finca al 36 % de pendiente: cumple los puntos y es un carton de huevos.

Medido sobre los siete anclajes: error de cota <= 0,46 m (medio 0,21), error de
pendiente <= 5,7 puntos (medio 1,3), pendiente de la finca 5,0 % de media y
11,2 % maxima.

**La pendiente se DERIVA** con `numpy.gradient` sobre la elevacion ya ajustada
—el mismo operador que usa el ajuste—, nunca se sortea aparte.

### La humedad es LATENTE

`grid_cells` no tiene columna de humedad y esta fase no la crea. La humedad
gobierna el escenario entero pero **nunca se guarda ni se sirve**: CERES solo la
ve de refilon, a traves de `soil_quality` y `health_factor`.

No es una carencia: es la fuente de error honesta que hace util la finca. La
diferencia entre lo que CERES predice y lo que se cosecho no es ruido que
metimos a mano, es una variable real del campo que el modelo actual no observa.

```
topografia --gradient--> pendiente
    |
    +--depresion local--> HUMEDAD (latente)
                             |
        +--------------------+--------------------+
        v                    v                    v
    suelo               sanidad t0          zonas de evento
```

La depresion va **destendenciada** (filtro de paso de banda, 90 m de tendencia /
25 m local). Medirla como `suavizado - elevacion` a secas no funciona sobre
terreno inclinado: R-09500, que es el fondo de la hondonada, salia con depresion
NEGATIVA por estar en la esquina alta de la finca.

La sanidad responde a la humedad con una **campana**, no una recta: demasiado
seco es malo, demasiado humedo tambien. Es lo que hace que el maiz seco del este
y la remolacha encharcada del noreste sufran por causas opuestas.

### Los eventos son ESPACIALES

Ninguna zona sale de un rango de `cell_code`. Cada una es el cuantil superior de
un campo continuo —humedad, depresion, distancia al borde o una banda
meteorologica—, asi que resultan contiguas sin que haya que imponerlo.

| Lote | Evento | Fecha | Zona | Tipo CERES |
|---|---|---|---|---|
| P | Gota (Phytophthora) | 05-12 | 18 % mas humedo | `disease` |
| M | Gusano cogollero | 06-05 | borde del lote | `pest` |
| M | Estres hidrico | 07-15 | 15 % mas seco | `water_stress` |
| Z | Granizada | 07-10 | banda meteorologica | `physical_damage` |
| R | Cercospora | 06-20 | humedo Y llano | `disease` |
| R | Inundacion parcial | 07-02 | hondonada cerrada | `physical_damage` |

**Las labores no se disfrazan de dano.** NPK, fungicida, riego, cincelado y
Boro/Zinc no tienen tipo en `ObservationType`, y meterlas como `other` con una
severidad las convertiria en un perjuicio. Se simulan como parametros de la
verdad y quedan listadas en el manifiesto. "Riego semanal" tampoco se convierte
en fechas: el escenario no las da.

---

## Verdad y prediccion son procesos distintos

Es la razon de ser del dataset. Si la verdad se calculara con el motor, CERES se
validaria contra si mismo y el error seria cero por construccion.

| VERDAD (`harvests`) | PREDICCION (`predictions`) |
|---|---|
| `truth_yield_field()` | `app.core.prediction`, **sin tocar** |
| ve la humedad latente | no la ve: no hay columna |
| danos propios (0,62 / 0,45 / 0,30) | `impact-v0` (0,45 / 0,30 / 0,25) |
| residuo propio, no guardado | `base_yield_factor`, guardado |
| sabe que hubo fungicida | no hay tabla de labores |

El generador **no reimplementa el motor**: llama a `state_at` y `predict` igual
que `services/predictions.py`, y hay un test que lo recalcula desde fuera y
exige coincidencia exacta.

### El rendimiento real

Se construye en dos pasos: primero el rendimiento RELATIVO de cada celda con
toda su variacion espacial, y despues **un unico factor multiplicativo por lote**
para que la media caiga en el objetivo. Escalar no toca la dispersion relativa,
asi que la suma cuadra exacta y la variacion se conserva.

Repartir el promedio a partes iguales daria desviacion tipica cero, y hay un
test que lo impide.

### La calibracion es CIEGA

```
base_yield_kg_per_m2 = objetivo_kg_por_celda / 0,75
```

**Una regla, la misma para los cuatro cultivos**, calculada antes de ejecutar
ninguna prediccion. `0,75` dice "en un ciclo normal se recoge tres cuartas
partes de lo que el cultivo daria en condiciones ideales": una cifra de tanteo,
no una medicion.

No se ajusta por lote ni se retoca despues de ver los errores. Hacerlo
convertiria el dataset en una prueba disenada para que el algoritmo aprobara, y
hay una consecuencia deliberada: **ningun test exige que t2 acierte mas que t0.**

---

## El eje temporal

Dos momentos por celda:

```
t0 = planted_at + 30 dias
t2 = harvested_at - 7 dias
```

| Lote | t0 | t2 |
|---|---|---|
| P | 2026-04-14 | 2026-08-13 |
| M | 2026-05-10 | 2026-09-08 |
| Z | 2026-05-31 | 2026-08-23 |
| R | 2026-05-20 | 2026-08-03 |

**Ninguna coincide con una fecha del ciclo**, y por eso la interfaz no puede
deducirlas: las obtiene de `GET /plots/{id}/timeline`, que lee los `as_of`
distintos que existen en `predictions`. Un lote sin predicciones devuelve la
lista vacia y la interfaz no ofrece control temporal — es el caso de la finca
demo.

Hubo un t1 intermedio. Se retiro porque en papa y zanahoria derivaba EL MISMO
estado que t2 —todos sus eventos ocurren antes, e `impact-v0` no modela
recuperacion ni crecimiento—, asi que 20.000 predicciones repetian otras 20.000.

`GET /plots/{id}/overview` acepta `as_of` y **recalcula** el estado con
`state_at`; no lee `predictions`. Los dos caminos coinciden hasta el ultimo
decimal, y un test lo vigila.

---

## Resultados medidos

Son **resultados**, no objetivos. Se midieron despues, sin tocar el generador.

| Lote | t0 | t2 |
|---|---|---|
| Papa | 8,62 % | 6,36 % |
| Maiz | 13,20 % | 12,60 % |
| Remolacha | 17,84 % | 11,59 % |
| Zanahoria | 22,49 % | 18,10 % |

Que zanahoria sea el peor lote, que maiz apenas mejore y que ningun lote llegue
a riesgo alto en ningun momento son resultados del motor. No se maquillan.

---

## Reproducibilidad

```bash
py scripts/generate_cuadricula.py                  # solo informa
py scripts/generate_cuadricula.py --apply          # carga
py scripts/generate_cuadricula.py --apply --reset  # regenera desde cero
```

Semilla **2026**. Comprobado: tres procesos distintos, uno con
`PYTHONHASHSEED` cambiado, producen la misma huella SHA-256. Los ids son UUID v5
derivados de una clave legible, asi que reejecutar produce exactamente los
mismos y `ON CONFLICT DO NOTHING` basta para la idempotencia.

`--reset` hace falta cuando cambia el GENERADOR: con los ids estables, una
segunda pasada conservaria los valores viejos y el dataset seria una mezcla
silenciosa de dos versiones. Los borrados van filtrados por `farm_id`, salvo
`predictions`, que solo se vacia con TRUNCATE —la migracion 0002 prohibe
DELETE—; por eso comprueba antes que no haya predicciones de otra finca.

El manifiesto completo, con todos los supuestos sinteticos y la desviacion de
cada celda de referencia, se genera con `--manifest` y esta en
[`cuadricula-manifest.json`](cuadricula-manifest.json).

---

## Deudas conocidas

1. `GET /plots/{id}/cells` no pagina: ~2,08 MB y ~1,2 s por lote.
2. Por debajo de `lg` el layout puede solaparse.
3. El eje temporal solo ofrece momentos que tienen predicciones guardadas.
4. `/performance` aun no esta conectado al eje temporal.
5. La finca demo conserva su circularidad: sus 24 observaciones derivan de
   `health_factor`, y desde el cambio de la puerta de procedencia si mueven su
   estado. La Cuadricula queda fuera de ese bucle porque su severidad sale del
   campo latente de humedad, no de la sanidad.
6. `actual_boxes` a 1 m2 no significa nada operativo: casi toda celda da 1 caja.
7. El canvas 3D puede quedarse negro tras ciertos redimensionados hasta recibir
   un evento `resize`. Solo reproducido en el harness de pruebas.
8. **M-00500 tiene una contradiccion entre su cota y su pendiente declaradas**, y
   se deja a la vista. Entre M-00500 (2108 m) y M-04500 (2112 m) hay 40 m: eso
   son 10 % de pendiente media, y el escenario las etiqueta como 3 % y 8 %. Un
   perfil suave que pase por las dos cotas con esas pendientes necesita ~12 % en
   el medio, asi que las tres cosas no pueden ser ciertas a la vez. El ajuste
   reparte el desacuerdo en vez de esconderlo y se lo carga a M-00500, que sale
   al 8,7 %. La desviacion se publica en el manifiesto.
9. La suite de PostgreSQL puede destruir el dataset; exige
   `CERES_PG_TESTS_MAY_TRUNCATE=1` y despues hay que recargar.
10. Recargar la finca cuesta unos 2 minutos.

---

## Relacionado

- [`synthetic-data.md`](synthetic-data.md) — la otra finca sintetica, la demo.
- [`cuadricula-manifest.json`](cuadricula-manifest.json) — manifiesto generado.
- [`prediction-model.md`](prediction-model.md) — el motor que consume el escenario.
