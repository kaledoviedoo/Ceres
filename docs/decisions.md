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

## D-028 — `GET /plots/{id}/overview`: calcular sin persistir

**Problema.** Para colorear 400 celdas por riesgo hacian falta 400 valores de
riesgo, y `CellSummary` solo trae estado del terreno. Las opciones eran 400
peticiones POST, calcular el riesgo en TypeScript, o un endpoint nuevo.

**Decision.** Un endpoint que ejecuta el motor sobre todo el lote y **no guarda
nada**. Reutiliza `run_engine()`, que ya estaba separado de `create_prediction()`
desde la fase 4.

**Por que no persistir.** Guardar 400 filas cada vez que alguien abre el
dashboard llenaria de ruido la tabla `predictions` y destruiria justo lo que la
hace valiosa: poder responder "que predijo CERES aquel dia". Guardar sigue
siendo un acto deliberado sobre una celda concreta.

**Como se evita la confusion.** La respuesta lleva `persisted: false` y las
celdas no tienen `id` ni `created_at`, porque no existen en ninguna tabla. El
panel lateral separa en pantalla "Estado del terreno" (guardado) de "Estimacion
actual (sin guardar)".

**Coste.** El motor se ejecuta 400 veces por carga de pagina. Con el modelo
determinista actual es instantaneo; el dia que el motor sea un modelo pesado
habra que cachear o paginar.

---

## D-029 — Los datos no viven en el store de Zustand

**Decision.** `useCeresStore` guarda seis identificadores y nada mas: finca,
lote, ciclo, celda seleccionada, celda bajo el cursor y modo de vista. Las
respuestas de la API las pide `app/page.tsx` y bajan por props.

**Por que.** El brief pedia "Zustand solo para estado de interfaz". La razon de
fondo: un store con las 400 celdas dentro es una cache, y una cache que nadie
invalida acaba mostrando datos del lote anterior. Manteniendo los datos en la
pagina, cambiar de lote los descarta solo.

**Lo que habilita.** Es la condicion para que la fase 7 sea una sustitucion de
componente y no una reescritura: la escena 3D leera y escribira el mismo
`selectedCellId` que lee y escribe el grid actual. Un test lo fija comprobando
que el store no tiene mas claves que esas seis.

**Cuando dejara de bastar.** Cuando haya varias pantallas compartiendo datos o
haga falta refetch en segundo plano. Ahi entraria TanStack Query. Para cuatro
peticiones, anadirlo ahora seria mas peso que ayuda.

---

## D-030 — Next 16 en lugar de Next 15

**Decision.** `next@16.3.3`, no la rama 15.

**Por que.** Al instalar `next@15.1.6`, npm reporto CVE-2025-66478. Subir a
15.5.24 no bastaba: `npm audit` seguia marcando cuatro avisos de `postcss`
—incluido uno de severidad alta por lectura arbitraria de archivos via
`sourceMappingURL`— y el unico arreglo disponible era Next 16.

Como el frontend no existia todavia, no habia ninguna migracion que pagar: usar
la version limpia salia mas barato que quedarse en una con vulnerabilidades
conocidas. `postcss` y `vitest` se subieron tambien a sus versiones parcheadas.

**Resultado.** `npm audit`: 0 vulnerabilidades.

**Nota de instalacion.** Tailwind 4 fallaba con
`Missing field 'negated' on ScannerOptions.sources`: el arbol de dependencias
mezclaba versiones del escaner nativo `@tailwindcss/oxide`. Se resolvio con una
reinstalacion limpia (`rm -rf node_modules package-lock.json`) tras alinear
`tailwindcss` y `@tailwindcss/postcss` en la misma version.

---

## D-031 — La API de CERES escucha en el 8010, no en el 8000

**Motivo.** El puerto 8000 de esta maquina ya lo ocupa otro proyecto del usuario
(un servicio "Jarvis"). `uvicorn` fallaba al enlazar con WinError 10013 y el
frontend acababa hablando con la aplicacion equivocada.

**Consecuencia a recordar.** `NEXT_PUBLIC_API_BASE_URL` se hornea en el build de
Next: cambiar el puerto obliga a reconstruir, no basta con reiniciar el
servidor. Perder diez minutos con eso es facil.

---

## D-032 — Sin valor por defecto para la URL de la API

**Que paso.** `client.ts` tenia `?? "http://localhost:8000"`. Parecia un defecto
razonable y era una trampa: en esta maquina el 8000 lo ocupa otra aplicacion, asi
que un `.env.local` ausente no daba un error de configuracion sino una
conversacion silenciosa con el backend equivocado.

**Decision.** No hay valor por defecto. `assertApiBaseUrl` valida que exista, que
sea una URL y que use http(s); si no, lanza `ConfigurationError` con un mensaje
que dice que falta y como arreglarlo. La comprobacion corre tambien en
`next.config.ts`, porque `NEXT_PUBLIC_*` se hornea en el build: fallar ahi evita
desplegar un frontend que apunta a ninguna parte.

**Detalle que costo un test.** `resolveApiBaseUrl` tenia el entorno como
parametro por defecto, asi que pasarle `undefined` activaba el valor del entorno
y era imposible probar el caso "falta la variable". Se partio en dos:
`assertApiBaseUrl(valor)` valida lo que le den, `resolveApiBaseUrl()` lee el
entorno.

**Y un detalle de orden.** La URL se resuelve FUERA del try/catch de `fetch`. Si
se resolviera dentro, el ConfigurationError se convertiria en un error de red y
volveriamos justo a la confusion que este cambio elimina.

---

## D-033 — `TerrainView`: el contenedor que aisla el hover

**Decision.** Un componente entre `page.tsx` y `CellGrid` que lee el store y
traduce a props.

**Por que.** `page.tsx` hacia `const {...} = useCeresStore()`, que suscribe al
store completo: cada celda que tocaba el cursor repintaba tambien el selector, el
panel del lote y el Cell Inspector. Ahora la pagina usa selectores individuales y
`hoveredCellId` solo lo lee `TerrainView`, asi que mover el raton no sale de la
malla.

**Lo medi antes de tocarlo:** 0,01 ms por hover. No era un problema en 2D —el
`memo` de `CellSquare` lo absorbia—. Importa de cara a R3F, donde un re-render
del arbol en cada movimiento compite con el bucle de render de la escena.

**Efecto secundario util.** `TerrainView` es ahora el punto de sustitucion
explicito de la fase 7: cambiar `CellGrid` por `TerrainCanvas` es cambiar una
linea de ese archivo. `CellGrid` sigue sin importar nada de `stores/` ni de
`lib/api/`.

---

## D-034 — La malla sigue el patron `grid` de ARIA, con roving tabindex

**Que estaba mal.** `role="grid"` con 400 `gridcell` colgando directamente, sin
`role="row"`. ARIA exige `grid > row > gridcell`; sin filas, `aria-rowindex` no
significa nada. Y las 400 celdas estaban en el orden de tabulacion: cruzar la
malla con teclado costaba 400 pulsaciones de Tab.

**Ahora.** 20 filas de 20 celdas. Solo la celda enfocada tiene `tabIndex 0`; las
flechas mueven el foco dentro de la malla, Home/End van a los extremos. Medido en
el navegador: **7 paradas de Tab en toda la pagina**, frente a 407.

Ademas `aria-selected` en lugar de `aria-pressed`: en un grid la celda es una
casilla seleccionable, no un conmutador.

**Senal no cromatica.** Verde, ambar y rojo son justo los tonos que confunde un
daltonismo rojo-verde. El nivel de riesgo lleva ahora una trama superpuesta cuya
densidad crece con la gravedad —liso, rayado suave, rayado marcado—, asi que se
lee tambien en escala de grises. Solo en modo riesgo: en los modos continuos el
valor es una rampa y la trama seria ruido.

**Lo que NO cambia.** El modelo, los umbrales y los colores. Es una capa de
lectura anadida, no una redefinicion del dominio.

---

## D-035 — ESLint de verdad, y lo que encontro

**Que estaba mal.** `npm run lint` ejecutaba `next lint`, que Next 16 elimino:
fallaba con "no such directory: .../lint" porque interpretaba `lint` como una
ruta. El proyecto no tenia linter, asi que un `eslint-disable` escrito a mano no
lo leia nadie.

**Ahora.** ESLint 9 con config plana. `eslint-config-next` 16 ya la publica
nativa, asi que no hace falta `FlatCompat` —que ademas fallaba con
"Converting circular structure to JSON" al intentar usarlo—.

**Lo que encontro en la primera pasada.** Dos `setState` sincronos dentro de
efectos, que encadenan renders para llegar al mismo sitio. Ninguno era cosmetico:

- `CellGrid` recortaba el foco con un efecto. Ahora se recorta al renderizar.
- `useApiResource` guardaba `isLoading` en estado. Ahora se DERIVA: "lo que tengo
  no corresponde a lo que quiero". De paso arregla que durante la carga se
  devolvieran los datos del recurso anterior como si fueran los del nuevo.

El linter tambien rechazo mutar una `ref` durante el render, asi que el fetcher
se guarda desde un efecto declarado antes que el de la peticion —los efectos
corren en orden de declaracion—.

**Resultado.** 0 errores, 0 warnings, sin un solo `eslint-disable` en el codigo.

---

## D-036 — Austeridad cromatica: el color solo significa riesgo

**Decision.** Todo el cromo de la interfaz es acromatico —negro-suelo a hueso—.
La unica saturacion en pantalla es la rampa semantica de riesgo, en el terreno y
en la leyenda.

**Por que.** Hasta la fase 6, `--color-ceres-accent` y `--color-risk-low` eran el
mismo hex (`#22c55e`): "activo" y "riesgo bajo" se veian igual. Habia tres
salidas —anadir un cuarto tono frio, desaturar el verde de marca, o sacar el
color del cromo— y la tercera es la unica que no crea un problema nuevo.

Ademas convierte una restriccion en una regla legible: si algo tiene color,
habla de riesgo. En una herramienta cuyo trabajo es que un agronomo distinga
tres niveles de un vistazo, que nada compita por la atencion cromatica es una
ventaja, no una renuncia.

**Neutros calidos y no frios.** Un gris azulado leeria como dashboard generico;
el negro con fondo de tierra y el hueso vienen del material del que trata el
producto.

**Coste.** La interfaz no tiene un color de marca visible. Se acepta: la marca
es la forma del terreno, no un acento.

---

## D-037 — El terreno es un bloque extraido, no un plano

**Decision.** La parcela se dibuja como un volumen solido con paredes de tierra
visibles. El analisis se pinta SOLO en la cara superior; los laterales son
suelo.

**Por que.** Un plano coloreado es un mapa; un bloque es una parcela. La
diferencia importa para lo que CERES dice ser: el usuario tiene que percibir que
inspecciona un trozo de campo real dividido en celdas, no una grafica cuadrada.
Separar la capa analitica del suelo hace explicito que el color es una lectura
sobre el terreno, no el terreno mismo.

**Como.** Dos mallas instanciadas: el bloque de suelo y una losa fina encima.
Dos llamadas de dibujo para 400 celdas, en vez de cuatrocientos objetos.

**Proporciones.** El primer intento (separacion 0.06, exageracion 3, grosor 1.2)
producia cuatrocientas columnas: un grafico de barras. Ahora la separacion es
0.02 —lo justo para ver la reticula—, el grosor 2.6 y la exageracion 1.5, y el
relieve se lee como ondulacion de una superficie.

**Exageracion vertical.** El terreno real varia 3,01 m sobre 20 × 20 m. A escala
1:1 la hondonada de la zona critica seria invisible desde una camara que abarca
el lote. Se exagera como lo hace un perfil topografico. No altera ningun dato: la
elevacion sigue mostrandose en metros en el inspector.

---

## D-038 — El hover sale del estado global

**Decision.** `hoveredCellId` y `hoverCell` desaparecen del store. Cada vista
resuelve el hover por dentro: `CellGrid` con estado local, `TerrainCanvas` con
referencias y escritura imperativa.

**Por que.** En 2D costaba 0,01 ms porque el `memo` de `CellSquare` lo absorbia.
En 3D `pointermove` dispara decenas de veces por segundo y cada evento habria
provocado un render de React mas una reconciliacion de la escena.

**Medido despues del cambio:** 0,007 ms por movimiento del raton sobre el
terreno, con 400 celdas. El coste de entrar y salir de una celda son dos
escrituras de color de instancia y una `transform`.

**Esto no debilita la regla del store, la refuerza.** Solo vive ahi lo que de
verdad es global; el hover no le interesa a nadie fuera de la vista que lo
dibuja. El contrato que importa —`cell_id` → `selectCell` → store → page → API—
no cambia.

---

## D-039 — Un canvas de WebGL no es accesible: la malla vive tambien en el DOM

**Decision.** El contenedor del canvas lleva `aria-hidden`, y sobre el se monta
`AccessibleCellLayer`: la misma malla como DOM real —`grid` → `row` →
`gridcell`, roving tabindex y flechas— invisible y sin capturar el puntero.

**Por que.** Un canvas es un mapa de pixeles: no tiene estructura recorrible ni
recibe foco por celda. Dar el terreno 3D por accesible porque se ve bien seria
perder de golpe todo lo que la fase 6 construyo.

`pointer-events: none` en la capa es imprescindible: sin eso, cuatrocientos
botones invisibles se tragarian los arrastres destinados a la camara. El teclado
llega igual, porque el foco no depende del puntero.

**Medido:** 13 paradas de tabulacion en toda la pagina —no 400—, flechas
moviendo el foco por la malla, y una region `aria-live` que anuncia la celda
seleccionada.

**Ademas se conserva la vista 2D** tras un conmutador visible: reserva cuando
WebGL no esta disponible o el equipo va justo, y lectura sin perspectiva.

---

## D-040 — Dos peticiones para el terreno, sin tocar el backend

**Decision.** El canvas 3D une `GET /plots/{id}/cells` y
`GET /plots/{id}/overview` por `cell_id` en el frontend.

**Por que.** El relieve necesita `elevation_m`, que esta en `CellSummary` y no en
`CellOverview`. Anadirla al overview habria sido un cambio de backend
innecesario, y ademas habria mezclado dos cosas distintas.

El reparto actual es el correcto: `/cells` dice **como ES** la parcela —da la
geometria— y `/overview` dice **que predice el motor** sobre ella —da el color—.
Emparejar dos listas por identificador no es una formula agronomica: los valores
llegan ya calculados.

**Regla que se mantiene.** Cero formulas agricolas en TypeScript, verificado por
grep. `lib/terrain/geometry.ts` solo convierte coordenadas de malla y metros en
unidades de mundo.

---

## Relacionado

- [architecture.md](architecture.md)
- [data-model.md](data-model.md)
- [prediction-model.md](prediction-model.md)
- [synthetic-data.md](synthetic-data.md)
