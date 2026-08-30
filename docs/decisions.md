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

## Relacionado

- [architecture.md](architecture.md)
- [data-model.md](data-model.md)
- [prediction-model.md](prediction-model.md)
- [synthetic-data.md](synthetic-data.md)
