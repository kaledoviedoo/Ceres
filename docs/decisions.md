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

## D-017 — El dataset sintetico no alcanzaba riesgo alto (RESUELTO en 4.6, ver D-026)

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

**Resuelto en la fase 4.6** con la opcion 1: se endurecio el generador con una
zona critica localizada, sin tocar el modelo. Detalle en D-026.

---

## D-018 — La aritmetica del error esta duplicada (Python y SQL) — reforzado en 4.6

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

**Resuelto en la fase 4.6.** `tests/postgres/test_performance_parity.py` ejecuta
20 casos —normales, limites y empates de redondeo— por los dos caminos y compara.
La lista de casos vive en `tests/performance_cases.py` y la consumen los dos
lados, asi que anadir un caso lo anade a ambos. El primer pase encontro dos
divergencias reales (ver D-025).

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

## D-021 — RLS activado sin politicas (deny-all para PostgREST)

**Decision.** `0004_security_hardening.sql` activa RLS en las 11 tablas sin
crear ni una politica.

**Por que.** Al desplegar por primera vez contra un Supabase real, el linter
reporto RLS desactivado en las 10 tablas del dominio. Supabase publica el
esquema `public` automaticamente por PostgREST, asi que cualquiera con la anon
key —publica por diseno, acaba en el bundle del frontend— podria leer y escribir
todo. En un PostgreSQL normal esto no pasa; en Supabase si, y es facil no verlo.

RLS sin politicas es deny-all para PostgREST. El backend no se ve afectado
porque conecta por `DATABASE_URL` con el rol propietario de las tablas, que no
esta sujeto a RLS (no se usa FORCE ROW LEVEL SECURITY).

**Lo que NO es.** No es el sistema de permisos del producto. Eso llega cuando
haya autenticacion real y politicas por organizacion. Esto solo cierra una
puerta que Supabase abre por defecto.

**Coste.** El linter deja un INFO permanente ("RLS enabled, no policy"). Es el
estado correcto, no un pendiente.

---

## D-022 — La conexion directa de Supabase resuelve solo por IPv6

**Hallazgo.** `db.<ref>.supabase.co` tiene registro AAAA pero no A. En una red
sin IPv6 global, la conexion directa simplemente no resuelve.

**Situacion actual.** La maquina de desarrollo tiene IPv6 y funciona. No se
adopta el pooler porque no hace falta y porque su hostname varia entre
proyectos: adivinarlo habria sido peor que usar la URI que da el dashboard.

**Si falla en otra red.** Copiar la connection string del pooler desde
Dashboard > Project Settings > Database. El resto de la configuracion no cambia.

**Dos ajustes obligatorios** sobre la URI que da Supabase, documentados en
`.env.example`:

- `postgresql+psycopg://` en vez de `postgresql://`: SQLAlchemy interpreta el
  segundo como psycopg2, que no esta instalado.
- `?sslmode=require`: cifrado en transito.

---

## D-023 — Los tests de PostgreSQL comparten base con la aplicacion

**Decision.** `TEST_DATABASE_URL` apunta a la misma base que `DATABASE_URL`.

**Por que.** El proyecto `ceres-mvp` existe solo para esto y todos sus datos son
sinteticos y regenerables. Crear un segundo proyecto solo para tests seria
infraestructura que nadie va a mantener en un MVP.

**Lo que obliga.** La limpieza tiene que ser quirurgica, y descubrirlo costo un
fallo real: la primera version hacia `TRUNCATE observations`, lo que habria
borrado las 24 del seed y roto el test que las cuenta, con el resultado
dependiendo del orden de ejecucion. Ahora:

- `predictions` y `harvests` se vacian con TRUNCATE (el seed no crea filas ahi;
  TRUNCATE y no DELETE porque el trigger bloquea el DELETE).
- `observations` no se vacia: solo se borran las creadas por los tests, que se
  distinguen porque llegan por la API y aun no llevan autor
  (`created_by IS NULL`).

**Cuando deja de valer.** En cuanto exista autenticacion, `created_by` dejara de
discriminar y habra que separar las bases o marcar las filas de test de otra
forma. Anotado en `tests/postgres/conftest.py`.

---

## D-024 — `text()` no sirve para SQL con literales que llevan `:`

**Hallazgo.** Dos bugs del mismo origen, ambos latentes hasta ejecutar contra
PostgreSQL real:

- `generate_demo_data.py --apply` usaba `text(sql)`, y el seed contiene
  timestamps como `'2026-04-20T14:00:00+00:00'`. SQLAlchemy leia cada `:` como
  un parametro de vinculacion.
- Un fixture insertaba JSONB inline (`'{"soil_factor":1.06}'`), con el mismo
  resultado.

**Correccion.** Para SQL crudo con literales, `exec_driver_sql()`. Para valores
dinamicos, parametros vinculados de verdad (`CAST(:factors AS jsonb)`), nunca
interpolacion.

**Leccion.** El codigo que solo se ejecuta contra un motor distinto al de
produccion no esta probado. Ninguno de los dos bugs podia aparecer en SQLite.

---

## D-025 — La aritmetica del error se hace en decimal, no en coma flotante

**Que paso.** El test diferencial de D-018, en su primera ejecucion, encontro dos
casos donde Python y la vista SQL daban numeros distintos:

    2.00005 - 1.0  ->  Python 1.0000   SQL 1.0001
    3.00025 - 2.0  ->  Python 1.0002   SQL 1.0003

**La causa no era el redondeo.** Era la resta. Los dos lados parten del mismo
float8, pero lo convierten a decimal de forma distinta: PostgreSQL usa 15 cifras
significativas (`extra_float_digits = 0`) y Python la representacion mas corta
que reproduce el float, 17 cifras. `1.0002499999999999` se le convierte a
PostgreSQL en `1.00025` —un empate exacto que redondea hacia arriba— mientras
Python ve un 4 en la quinta posicion.

**Decision.** No imitar la peculiaridad de ninguno de los dos: **no restar en
binario**. Cada operando se convierte a decimal por separado —donde ambos
coinciden, porque los valores almacenados tienen 4 decimales— y la resta y la
division ocurren en aritmetica decimal exacta. Python con `decimal.Decimal`,
SQL casteando cada columna a `numeric` antes de operar (migracion 0005).

El redondeo es HALF-UP en ambos: es lo que hace `round(numeric, n)` y lo que
espera cualquiera que lea un porcentaje. `round()` de Python usa redondeo
bancario y daria `2.0` donde SQL da `2.0001`.

**Fuente de verdad.** `app/domain/performance.py`. La vista es su espejo para
consultas ad-hoc y BI; si discrepan, el que esta mal es el SQL.

**Limite conocido.** Un valor insertado a mano con mas de 15 cifras
significativas se renderizaria distinto en cada lado. No ocurre en CERES —el
motor redondea a 4 decimales y las cosechas entran por un schema Pydantic— pero
queda anotado en el modulo.

---

## D-026 — La zona critica es un escenario sintetico, no un hallazgo

**Decision.** El dataset incluye un foco localizado de deterioro extremo que
produce celdas de `risk_level = high`.

**Por que hizo falta.** Sin el, el dataset daba 136 `low`, 264 `medium` y cero
`high`: la vista de riesgo del frontend solo habria podido mostrar dos de los
tres colores, y el caso rojo no se ejercitaria nunca.

**Por que se toco el generador y no el modelo.** Bajar el umbral de `high` o
subir el peso de la sanidad habria producido celdas rojas igual de rapido, y
habria sido cambiar el modelo para que los datos quedaran bonitos. El modelo
—pesos, umbrales, formulas— esta exactamente igual que en la fase 3.

**Como esta hecho.** Una campana gaussiana en (nx=0.12, ny=0.72), sigma 0.10, que
hunde la sanidad 0.75, el suelo 0.35 y el terreno 60 cm. Tres propiedades que
importan:

- es una campana, no un recorte: la transicion `high -> medium -> low` es
  continua y hay un test que comprueba que el anillo del foco es `medium`;
- esta dentro del area de estres del oeste, asi que la peor zona se agrava en vez
  de aparecer un parche donde no tocaba;
- deforma tambien el relieve, porque en la fase 7 el terreno 3D se construye con
  la elevacion y una zona critica plana se veria como pintura.

**Como se sabe que no se toco el modelo.** Un test pone las tres penalizaciones a
cero y comprueba que sin la zona no queda ninguna celda `high`, con el mismo
motor y los mismos umbrales.

**Lo que NO es.** No es agronomia, no es un fenomeno observado y no es evidencia
de nada. Es un caso de prueba dibujado a mano, y esta etiquetado como tal en el
codigo y en la documentacion.

**Resultado:** 134 `low`, 232 `medium`, 34 `high`, en un unico foco contiguo.

---

## D-027 — El seed borra sus propias filas huerfanas antes de insertar

**Que paso.** Al aplicar el dataset con la zona critica sobre el Supabase que ya
tenia el anterior, la base acabo con **48 observaciones en lugar de 24**.

**Por que.** El id de una observacion es `uuid5(cell_code, orden)` y que celdas se
observan depende de cuales son las mas debiles. La zona critica cambio esa
seleccion, asi que los ids nuevos no colisionaron con los viejos: el
`ON CONFLICT DO UPDATE` inserto 24 y dejo vivas las 24 anteriores.

**La leccion.** `ON CONFLICT DO UPDATE` da idempotencia sobre las filas que
siguen existiendo, no sobre el conjunto de filas. Cuando el generador decide
cuantas filas hay y cuales, hace falta borrar explicitamente.

**Solucion.** El seed generado empieza con una limpieza acotada:

    DELETE FROM observations WHERE created_by IN (<usuarios del seed>);
    DELETE FROM grid_cells WHERE plot_id IN (<lotes>) AND (x >= W OR y >= H);

La primera borra solo lo que el seed creo —las observaciones que llegan por la
API no llevan autor y sobreviven, y hay un test que lo comprueba—. La segunda
cubre el caso de regenerar con una malla mas pequena, sin necesidad de listar
800 ids: las celdas sobrantes son exactamente las que caen fuera del rectangulo.

**No se toca** `predictions` ni `harvests`: son datos del sistema en ejecucion,
no del seed.

---

## Relacionado

- [architecture.md](architecture.md)
- [data-model.md](data-model.md)
- [prediction-model.md](prediction-model.md)
- [synthetic-data.md](synthetic-data.md)
