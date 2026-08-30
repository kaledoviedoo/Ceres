# Decisiones

Registro de por que el sistema es como es. Cada entrada dice que se decidio, por
que, y que se pierde con ello.

---

## D-001 — FastAPI + Pydantic para el backend

**Decision.** Python con FastAPI y Pydantic v2.

**Por que.** El nucleo del producto es matematica agricola, y ese ecosistema
(NumPy hoy, scikit-learn o PyTorch manana) es Python. Poner la logica en Node
significaria reescribirla el dia que llegue el ML. Pydantic ademas hace que el
contrato de la API sea codigo ejecutable y no un documento que se desactualiza.

**Coste.** Dos lenguajes en el repositorio.

---

## D-002 — Next.js + React Three Fiber para el frontend

**Decision.** Next.js, TypeScript, Tailwind, Zustand, R3F.

**Por que.** R3F permite escribir la escena 3D con componentes React en lugar de
gestionar el ciclo de vida de Three.js a mano. Y la representacion 3D **es** el
producto de cara al usuario: una finca es espacial, y una tabla no comunica eso.

**Coste.** El 3D tienta a meter logica en el cliente. Se contrarresta con la
regla dura de la arquitectura: nada de agricultura en TypeScript.

---

## D-003 — Supabase / PostgreSQL

**Decision.** Postgres. Supabase gestionado, Postgres local en Docker para
desarrollo.

**Por que.** Supabase *es* Postgres, asi que no hay lock-in real: lo que funciona
local funciona en produccion. Trae auth, storage y realtime cuando hagan falta,
sin montarlos ahora. Y PostGIS esta disponible el dia que el MVP necesite
geometria de verdad.

**Coste.** Ninguno relevante en esta fase.

---

## D-004 — Modelo determinista antes que ML

**Decision.** `rule-based-v0.1`, formulas explicitas. Sin ML.

**Por que.** No hay datos con los que entrenar: no existe una sola cosecha real
registrada. Un modelo entrenado con datos sinteticos solo aprenderia a
reproducir el generador. Ademas, cuando la prediccion falle frente a la cosecha
real, un modelo explicable dice *que factor* fallo; una red neuronal no dice
nada.

**Coste.** Las predicciones no son buenas. No importa: lo que se esta validando
es el ciclo, no la precision.

---

## D-005 — Dataset sintetico con seed fija

**Decision.** SEED = 42, UUID v5 deterministas.

**Por que.** Los tests pueden afirmar cosas sobre valores concretos. Dos personas
regenerando el dataset obtienen los mismos `cell_id`, asi que un bug se reproduce
en la maquina del otro. Y reaplicar el seed actualiza en lugar de duplicar.

**Coste.** Hay que resistir la tentacion de meter `datetime.now()` o `random()`
sin seed en el generador. Un test lo vigila.

---

## D-006 — La pendiente se deriva de la elevacion

**Decision.** `slope_deg` no se sortea: sale del gradiente del campo de elevacion.

**Por que.** Sorteandola aparte habria celdas planas en mitad de una ladera. El
terreno seria fisicamente imposible y el render 3D lo delataria. Derivarla es mas
simple *y* mas correcto.

**Coste.** Ninguno. Es la clase de decision que sale gratis si se toma pronto.

---

## D-007 — CropCycle en vez de `Plot.crop_id`

**Decision.** El cultivo cuelga de un ciclo, no del lote.

**Por que.** Un lote siembra tomate en 2026 y pimenton en 2027. Con `crop_id` en
el lote, empezar la temporada nueva sobrescribiria el campo y dejaria todas las
predicciones y cosechas historicas apuntando a un cultivo equivocado.

**Coste.** Una tabla y un join mas. Barato comparado con perder la historia.

---

## D-008 — Predicciones inmutables, reforzado en la base de datos

**Decision.** Trigger que rechaza `UPDATE` y `DELETE` sobre `predictions`.

**Por que.** "No sobrescribir predicciones" como convencion se rompe el primer
dia que alguien arregla una fila desde el editor SQL de Supabase. Como
restriccion de la base de datos, no se rompe.

**Coste.** Purgar datos de demo necesita `TRUNCATE` explicito
(`scripts/reset_demo_data.sql`). Es justo la friccion que se buscaba.

---

## D-009 — Migraciones SQL a mano, no un ORM que genere el esquema

**Decision.** Archivos `.sql` numerados en `database/migrations/` como fuente de
verdad. Los modelos SQLAlchemy los reflejan.

**Por que.** El esquema se lee entero en un archivo, se pega en el editor de
Supabase, y no depende de la version de ninguna libreria. Alembic o el CLI de
Supabase pueden entrar despues sin reescribir nada.

**Coste.** Modelos y migraciones se pueden desincronizar. Mitigado con
`test_models.py`, que compara las tablas y las columnas de `grid_cells` contra
el SQL.

**Alternativa descartada.** `Base.metadata.create_all()`: rapido al principio,
inmanejable en cuanto haya que migrar datos existentes.

---

## D-010 — Cuatro representaciones de una celda

**Decision.** Tabla SQL, modelo SQLAlchemy, schema Pydantic y dataclass de
entrada del motor.

**Por que.** Parece duplicacion, pero cada una tiene un motivo distinto. La que
justifica el resto es la cuarta: el motor recibe **valores planos**, no un modelo
de SQLAlchemy. Por eso se puede testear sin base de datos, ejecutar desde un
notebook y sustituir sin tocar la API.

**Coste.** Anadir un campo a una celda toca cuatro sitios. Aceptado.

---

## D-011 — `app/domain/` para el vocabulario compartido

**Decision.** Enums, umbrales de riesgo y conversiones en un paquete sin
dependencias, importable desde modelos, schemas y motor.

**Por que.** Los umbrales de riesgo tienen que ser iguales en la base de datos
(CHECK), en la API (schema) y en el motor. Definidos tres veces, se separan.

Esta carpeta no estaba en la estructura del brief. Es la unica desviacion
estructural, y es pequena.

---

## D-012 — `docs/synthetic-data.md` como documento propio

**Decision.** Un sexto documento, ademas de los cinco del brief.

**Por que.** El generador sintetico tiene formulas, parametros y patrones
espaciales propios. Meterlos en `prediction-model.md` mezclaria dos cosas que
conviene no confundir nunca: **como se inventan los datos** y **como se predice
sobre ellos**. Confundirlas es como se acaba evaluando un modelo contra su propio
generador.

---

## D-013 — El entorno virtual vive fuera del repositorio

**Decision.** `C:\Users\User\.virtualenvs\ceres`, no `./.venv`.

**Por que.** El proyecto esta dentro de una carpeta sincronizada por OneDrive.
Un `.venv` ahi dentro son decenas de miles de archivos que OneDrive intentaria
sincronizar continuamente, con bloqueos de archivo durante los `pip install`.
Lo mismo aplicara a `node_modules/` en la fase 5.

**Coste.** Hay que activar el entorno por ruta absoluta. Documentado en el README.

---

## D-014 — Rendimiento multiplicativo, perdida aditiva

**Decision.** El rendimiento multiplica factores; la perdida suma causas.

**Por que.** No es una asimetria caprichosa. Multiplicativo en el rendimiento
porque una celda con sanidad 0 tiene que dar 0 kg, y porque el desglose se lee
directo en la UI como porcentajes. Aditivo en la perdida porque las causas se
acumulan: una celda empinada Y enferma pierde por las dos razones, y
multiplicarlas daria menos perdida que cada una por separado.

**Coste.** Dos mentalidades distintas en el mismo motor. Documentado en cada
modulo para que nadie "corrija" la inconsistencia aparente.

---

## D-015 — Redondear el rendimiento antes de calcular las cajas

**Decision.** `projected_yield_kg` se redondea a 4 decimales y las cajas se
calculan sobre el valor redondeado.

**Por que.** `ceil()` amplifica el error de coma flotante: `12.000000000000002 / 6`
redondeado hacia arriba da 3 cajas en vez de 2. Ademas garantiza que las cajas
guardadas correspondan al rendimiento guardado, y no a un valor intermedio que
nadie puede ver.

**Coste.** Ninguno a la escala del MVP.

---

## D-016 — El motor recibe protocolos, no modelos

**Decision.** `predict(cell, crop)` acepta cualquier objeto que exponga los
atributos de `CellState` y `CropSpec` (`typing.Protocol`, tipado estructural).

**Por que.** El motor tiene que funcionar sin base de datos: desde un test, un
script o un notebook. Importar `GridCell` de SQLAlchemy lo ataria a la capa de
persistencia justo en el modulo que mas falta hace mantener aislado. Con
protocolos, un `GridCell` real sirve sin heredar de nada, y un dataclass de
tres lineas tambien.

**Alternativa descartada.** Que el motor importara los modelos y los servicios
le pasaran objetos ORM: mas corto de escribir, imposible de testear aislado.

---

## D-017 — El dataset sintetico no alcanza riesgo alto (PENDIENTE)

**Observacion.** Ejecutando `rule-based-v0.1` sobre las 400 celdas de Plot A con
la seed 42, el `risk_score` maximo es 0.5997: **cero celdas en `high`**, 264 en
`medium`, 136 en `low`.

**Causa.** Esta en el generador, no en el motor. `TerrainProfile` nunca lleva la
sanidad por debajo de ~0.50 ni el suelo por debajo de ~0.44.

**Por que no se ha "arreglado".** Retocar el generador o los umbrales para que
salgan numeros mas vistosos es exactamente como se acaba evaluando un modelo
contra su propio generador. La decision es del producto, no del motor.

**Opciones, para decidir antes de la fase 5:**

1. Endurecer `TerrainProfile` con una zona realmente mala. Es lo mas realista:
   las fincas tienen esquinas malas. Cambia todos los datos de demo.
2. Bajar `RISK_HIGH_THRESHOLD` de 0.66. Barato, pero cambia el significado de
   "riesgo alto" en todo el sistema.
3. Dejarlo. La vista de riesgo del frontend solo mostrara dos de los tres
   colores, y el caso rojo no se ejercitara en la demo.

**Recomendacion.** Opcion 1, cuando llegue la fase 5 y se vea el mapa. Hasta
entonces no hay informacion suficiente para elegir bien.

---

## D-018 — La aritmetica del error esta duplicada (Python y SQL)

**Situacion.** `app/domain/performance.py` calcula `absolute_error_kg` y
`percentage_error` para la API. La vista SQL `cell_performance` (migracion 0003)
calcula lo mismo.

**Por que se acepta la duplicacion.** La API necesita una implementacion
portable: la vista usa `LEFT JOIN LATERAL`, que no existe en SQLite, y sin
Docker los tests de integracion no pueden ejecutarla. La vista, a su vez, es lo
que hace utiles las consultas ad-hoc y cualquier BI que se conecte a Supabase.

**Coste real y como se contiene.** Si una cambia sin la otra, la API y las
consultas manuales daran numeros distintos sobre los mismos datos. Contencion:
ambas llevan un comentario que apunta a la otra, los dos redondean a 4 decimales,
y `tests/unit/test_performance.py` fija los valores de referencia.

**Cuando resolverlo.** En cuanto haya un PostgreSQL disponible: se anade un test
de integracion que ejecute la vista y compare fila a fila con el helper de
Python. Hasta entonces la divergencia es posible y nadie la detectaria.

---

## D-019 — Tests de integracion sobre SQLite, no sobre PostgreSQL

**Decision.** Los 60 tests de integracion levantan el esquema con
`Base.metadata.create_all()` sobre SQLite en memoria.

**Por que.** No hay Docker en la maquina de desarrollo. La alternativa era no
tener tests de integracion en absoluto, y eso es peor: SQLite verifica de verdad
el cableado HTTP -> servicio -> motor -> ORM -> respuesta, los schemas, los
codigos de error y la persistencia.

**Coste, explicito.** Todo lo especifico de PostgreSQL queda sin probar: las
migraciones SQL, el trigger de inmutabilidad, la vista `cell_performance`, los
CHECK constraints y los tipos nativos. La lista completa esta en
`tests/conftest.py` y en [api.md](api.md). No se ha ejecutado ni una vez contra
Postgres, y este documento no pretende lo contrario.

**Consecuencia en el codigo.** Los modelos usan `sqlalchemy.Uuid` y
`JSON().with_variant(JSONB, "postgresql")` en lugar de los tipos del dialecto
`postgresql`. En PostgreSQL el resultado es identico (uuid nativo y jsonb); lo
que cambia es que el esquema tambien puede levantarse en otro motor.

---

## D-020 — El 409 por celda y ciclo de lotes distintos

**Decision.** Pedir una prediccion, observacion o cosecha para una celda que no
pertenece al lote del ciclo de cultivo devuelve 409, no 422 ni 404.

**Por que.** La peticion es sintacticamente valida (dos UUID que existen), pero
incoherente con el estado del sistema. No puede detectarlo un schema porque hace
falta leer la base de datos, y no es un 404 porque ambos recursos existen.

**Coste.** Una consulta extra por peticion de escritura. A cambio, la base de
datos no acumula predicciones sobre pares celda/ciclo que no significan nada.

---

## Relacionado

- [architecture.md](architecture.md)
- [data-model.md](data-model.md)
- [prediction-model.md](prediction-model.md)
- [synthetic-data.md](synthetic-data.md)
