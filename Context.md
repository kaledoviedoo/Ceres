0. CONTEXTO DEL PRODUCTO
¿Qué es CERES?

CERES es un SaaS B2B de inteligencia agrícola basado en el concepto de Digital Twin.

Representa una finca agrícola como un modelo espacial dividido en celdas de aproximadamente 1 m².

Cada celda representa una unidad agrícola sobre la cual CERES puede almacenar características, generar predicciones, registrar observaciones y posteriormente comparar esas predicciones contra los resultados reales de cosecha.

El objetivo final es que un agrónomo pueda seleccionar una celda o zona de una finca y obtener información como:

rendimiento proyectado en kg
toneladas proyectadas
cajas necesarias
porcentaje estimado de pérdida
nivel de riesgo
factores que influyen en la predicción
observaciones registradas
posteriormente, rendimiento real de cosecha
error entre predicción y resultado real
1. OBJETIVO DEL MVP

Este proyecto es un MVP de validación técnica y conceptual.

NO estamos construyendo todavía una plataforma empresarial escalable.

NO necesitamos:

Kubernetes
microservicios
arquitectura distribuida
procesamiento masivo
colas complejas
múltiples regiones
infraestructura cloud avanzada
ML sofisticado
ingestión satelital real
IoT real
mapas GIS profesionales
sistema multi-tenant complejo

Queremos demostrar que el concepto funciona de extremo a extremo.

El MVP debe permitir:

Finca
  ↓
Lote
  ↓
Cultivo / ciclo de cultivo
  ↓
Celdas de 1 m²
  ↓
Características de cada celda
  ↓
Predicción matemática
  ↓
Visualización
  ↓
Observaciones
  ↓
Cosecha real
  ↓
Comparación predicción vs realidad
2. PRINCIPIO ARQUITECTÓNICO MÁS IMPORTANTE

El sistema debe estar separado conceptualmente en:

FRONTEND
    ↓
API
    ↓
DOMAIN / CORE
    ↓
DATABASE

Y específicamente:

El frontend 3D NO debe calcular agricultura.

React Three Fiber / Three.js únicamente representa información.

Debe hacer:

hover
click
selección
visualización
colores
cámara

Pero NO debe contener lógica como:

yield = ...
loss = ...
risk = ...

Toda lógica agrícola debe vivir en Python.

3. STACK OBLIGATORIO

Utiliza:

Backend
Python
FastAPI
Pydantic
NumPy
pytest
Database
Supabase
PostgreSQL

Para el MVP se puede usar PostgreSQL normal con estructura espacial simple.

No es necesario implementar PostGIS profundamente todavía, pero diseña las entidades de forma que posteriormente pueda incorporarse.

Frontend
Next.js
TypeScript
Tailwind CSS
Zustand
React Three Fiber
Three.js
Comunicación

REST API + JSON.

4. PRINCIPIO DE DESARROLLO

NO empieces construyendo el modelo 3D.

NO empieces por Tailwind.

NO empieces por animaciones.

NO empieces por shaders.

NO empieces por el dashboard visual.

Primero debemos conseguir:

cell → prediction → API → response

funcionando.

Después:

frontend → API → prediction

Después:

3D cell → API → prediction
5. MODELO DE DOMINIO

Construye inicialmente estas entidades:

Organization
Farm
Plot
Crop
CropCycle
GridCell
Prediction
Observation
Harvest
User

Relaciones:

Organization
    │
    └── Farm
          │
          ├── Plot
          │      │
          │      └── GridCell
          │
          └── CropCycle
                   │
                   ├── Predictions
                   ├── Observations
                   └── Harvests

Importante:

Un cultivo NO debe estar directamente ligado permanentemente a una finca o lote.

Debe existir:

CropCycle

porque un lote puede cultivar diferentes productos en diferentes temporadas.

Ejemplo:

Plot A
    ↓
CropCycle 2026
    ↓
Tomato
6. MODELO DE GridCell

Cada celda representa aproximadamente 1 m².

Para el MVP debe contener como mínimo:

id
plot_id
x
y
elevation
slope
soil_quality
plant_density
health_factor
base_yield_factor

Puedes agregar otros campos si son útiles, pero no compliques innecesariamente el MVP.

La identidad de la celda debe ser:

cell_id

No dependamos exclusivamente de x/y para identificarla.

7. DATOS GEOGRÁFICOS

NO necesitamos una finca real inicialmente.

Construye un dataset geográfico sintético que represente una finca ficticia ubicada en un lugar aleatorio de Colombia.

Por ejemplo:

Farm:
"CERES Demo Farm"

Location:
Colombia

Plot:
"Plot A"

Grid:
20 × 20

Total:
400 m²

Posteriormente podemos aumentar el tamaño.

Genera características sintéticas plausibles:

elevation
slope
soil_quality
plant_density
health_factor

Estas variables NO deben ser completamente aleatorias sin estructura.

Quiero que generes patrones espaciales.

Por ejemplo:

zona norte:
mayor elevación

zona sur:
menor elevación

zona este:
mejor suelo

zona oeste:
mayor riesgo

Esto permitirá que el mapa realmente tenga patrones visuales.

8. DATOS SINTÉTICOS PERO DETERMINISTAS

El dataset de prueba debe poder regenerarse.

Utiliza una seed fija.

Ejemplo conceptual:

SEED = 42

Así:

generar dataset

siempre produce los mismos datos.

Esto es importante para reproducibilidad.

Crea un script como:

scripts/generate_demo_data.py
9. MOTOR DE PREDICCIÓN

Crear un módulo completamente independiente:

backend/
    app/
        core/
            prediction/

o una estructura equivalente limpia.

El motor debe poder hacer:

result = predict(cell, crop_cycle)

y devolver un objeto estructurado.

10. PRIMER MODELO MATEMÁTICO

NO utilizar Machine Learning todavía.

Necesitamos primero un modelo determinista y explicable.

La idea inicial puede ser:

base_yield
×
plant_density_factor
×
soil_factor
×
health_factor
×
terrain_factor
=
projected_yield_kg

Ejemplo:

base_yield = 12 kg/m²

plant_density_factor = 0.95
soil_factor = 1.10
health_factor = 0.85
terrain_factor = 0.92

projected_yield =
12 × 0.95 × 1.10 × 0.85 × 0.92

No importa si los valores son ficticios.

Lo importante es que el modelo sea:

determinista
explicable
testeable
reemplazable
11. PREDICCIÓN DE CAJAS

Cada cultivo debe tener una capacidad aproximada de kg por caja.

Ejemplo:

Tomato:
box_capacity_kg = 6

Entonces:

projected_boxes =
ceil(projected_yield_kg / box_capacity_kg)
12. PREDICCIÓN DE PÉRDIDA

Crear una fórmula simple y explicable.

Por ejemplo:

base_loss
+
terrain_loss
+
health_loss
+
soil_loss

Debe estar limitada:

0% <= loss <= 100%

No permitas valores absurdos.

13. RIESGO

Crear un risk score normalizado:

0 → bajo riesgo
1 → alto riesgo

Puede derivarse inicialmente de:

health_factor
soil_quality
slope

Ejemplo:

risk_score =
weighted combination of risk factors

Documenta claramente la fórmula.

14. RESULTADO DEL MOTOR

La respuesta debe ser aproximadamente:

{
  "cell_id": "A-00123",
  "projected_yield_kg": 18.4,
  "projected_yield_tons": 0.0184,
  "projected_boxes": 4,
  "estimated_loss_percentage": 7.8,
  "risk_score": 0.21,
  "risk_level": "low",
  "model_version": "rule-based-v0.1"
}

Puedes incluir:

factors

para explicar el resultado:

{
  "soil_factor": 1.1,
  "health_factor": 0.85,
  "terrain_factor": 0.92
}

Esto será importante posteriormente para explicar las predicciones.

15. VERSIONADO DEL MODELO

Todas las predicciones deben guardar:

model_version

Por ejemplo:

rule-based-v0.1

No queremos que una predicción histórica cambie mágicamente cuando cambiemos la fórmula.

16. DATABASE

Crear migraciones SQL claras.

Tablas iniciales:

organizations
farms
plots
crops
crop_cycles
grid_cells
predictions
observations
harvests
users

No inventes 30 tablas.

MVP simple.

17. PREDICTIONS

La tabla predictions debe almacenar una fotografía histórica de la predicción.

Campos mínimos:

id
cell_id
crop_cycle_id
model_version
projected_yield_kg
projected_boxes
estimated_loss_percentage
risk_score
created_at

IMPORTANTE:

No sobrescribir predicciones históricas.

Cada predicción es un registro.

Queremos poder responder:

¿Qué predijo CERES en ese momento?

18. OBSERVATIONS

Crear sistema para que un usuario pueda registrar observaciones sobre una celda.

Ejemplos:

pest
disease
water_stress
physical_damage
other

Campos:

id
cell_id
type
severity
description
created_at

Severity:

0 → 1
19. HARVEST

Crear registro de cosecha real.

Campos mínimos:

id
cell_id
crop_cycle_id
actual_yield_kg
actual_boxes
harvested_at
20. VALIDACIÓN PREDICCIÓN VS REALIDAD

Cuando exista:

Prediction
+
Harvest

calcular:

absolute_error_kg
percentage_error

Ejemplo:

Predicción:
18.4 kg

Real:
16.2 kg

Error:
2.2 kg

Error %:
13.58%

NO entrenar ML todavía.

Primero queremos construir el ciclo de feedback.

21. API

Crear API versionada:

/api/v1/

Endpoints iniciales:

GET  /farms
GET  /farms/{farm_id}

GET  /plots/{plot_id}

GET  /plots/{plot_id}/cells

GET  /cells/{cell_id}

POST /predictions

GET  /cells/{cell_id}/predictions

POST /observations

GET  /cells/{cell_id}/observations

POST /harvests

GET  /cells/{cell_id}/harvests

GET  /cells/{cell_id}/performance
22. API CONTRACT

Todos los endpoints deben tener Pydantic schemas.

Crear algo como:

schemas/
├── farm.py
├── plot.py
├── cell.py
├── prediction.py
├── observation.py
└── harvest.py

No devolver diccionarios arbitrarios desde los endpoints.

23. FRONTEND V0

Antes de Three.js crear una interfaz 2D sencilla.

Debe mostrar:

20 × 20 grid

Cada cuadrado representa:

1 m²

Colores según:

yield
risk
loss

Al hacer click:

selectedCell

y abrir un panel lateral.

24. PANEL DE CELDA

Debe mostrar:

CELL A-00123

Projected Yield
18.4 kg

Projected Boxes
4

Estimated Loss
7.8%

Risk
LOW

Model
rule-based-v0.1

Y debajo:

Factors

Soil
+10%

Health
-15%

Terrain
-8%
25. ZUSTAND

Usar Zustand solamente para estado global de UI.

Ejemplo:

selectedFarm
selectedPlot
selectedCell
viewMode
cameraState

No meter toda la base de datos en Zustand.

26. PRIMER MILESTONE REAL

Antes de implementar cualquier 3D, debe funcionar:

Grid 20 × 20
       ↓
click cell
       ↓
cell_id
       ↓
API
       ↓
Prediction Engine
       ↓
Prediction
       ↓
Side Panel

Si esto funciona, CERES V0.1 ya existe.

27. DESPUÉS: REACT THREE FIBER

Una vez terminado el flujo anterior:

crear:

TerrainCanvas

Componentes:

TerrainCanvas
├── Terrain
├── Grid
├── Cells
├── Camera
├── Lighting
└── Interaction
28. TERRENO 3D

No necesitamos inicialmente un modelo 3D real.

Utiliza los datos sintéticos:

elevation

para deformar una superficie.

Conceptualmente:

elevation
    ↓
vertex height
    ↓
terrain mesh

La finca debe verse como una superficie ligeramente ondulada.

29. GRID 3D

Sobre el terreno:

1m × 1m cells

Debe existir correspondencia:

GridCell ID
     ↕
3D Cell

El usuario debe poder hacer raycasting y determinar:

cell_id

al hacer click.

30. PERFORMANCE

Para el MVP:

20 × 20 = 400 cells

Está bien.

Pero NO diseñes una arquitectura donde cada celda haga una petición HTTP al cargar.

Inicialmente:

GET /plots/{id}/cells

puede devolver las 400 celdas.

Después:

GET /cells/{id}

para detalles.

31. MODOS VISUALES

Crear:

Yield View
Risk View
Loss View
Observations View

Ejemplo:

Yield
green = high
yellow = medium
red = low

No hardcodear colores agrícolas dentro de la lógica del backend.

El backend devuelve valores.

Frontend decide cómo representarlos.

32. OBSERVACIONES EN EL 3D

Cuando una celda tenga observación:

mostrar un indicador.

Ejemplo:

cell
  +
  ⚠

Al seleccionar:

Observation:
Disease

Severity:
0.7

Description:
Possible fungal infection
33. HARVEST FEEDBACK

Desde el panel de una celda:

[Register Harvest]

Formulario:

Actual yield kg
Actual boxes
Date

Al guardar:

mostrar:

Predicted:
18.4 kg

Actual:
16.2 kg

Error:
13.58%
34. SEGUIMIENTO

Crear una sección:

Cell Performance

que muestre:

Prediction History

Date        Prediction    Actual    Error
--------------------------------------------
Aug 30      18.4 kg       16.2 kg   13.58%

Esto es fundamental para el concepto de Digital Twin.

35. DATA FLOW FINAL DEL MVP

El flujo completo debe terminar siendo:

                 FARM
                  │
                  ▼
                 PLOT
                  │
                  ▼
              GRID CELLS
                  │
                  ▼
         CELL CHARACTERISTICS
                  │
                  ▼
          PREDICTION ENGINE
                  │
                  ▼
             PREDICTION
                  │
                  ▼
              FRONTEND
                  │
          ┌───────┴────────┐
          ▼                ▼
    OBSERVATION          USER
          │
          ▼
       HARVEST
          │
          ▼
   ACTUAL PERFORMANCE
          │
          ▼
 PREDICTION VS REALITY
36. TESTING

Crear tests desde el comienzo.

Backend:

tests/
├── unit/
│   ├── test_prediction.py
│   ├── test_loss.py
│   ├── test_risk.py
│   └── test_grid_generation.py
│
└── integration/
    └── test_prediction_api.py

Tests mínimos:

yield never negative
loss between 0 and 100
risk between 0 and 1
boxes never negative
same input → same output
model_version exists
prediction stored
harvest comparison works
37. DEMO DATA

Crear un comando:

python scripts/generate_demo_data.py

Debe crear:

1 organization
1 farm
2 plots
1 crop
1 crop cycle
400 cells per plot
synthetic observations

No necesitamos datos reales.

Pero los datos deben ser plausibles.

38. DOCUMENTACIÓN

Crear:

docs/
├── architecture.md
├── data-model.md
├── prediction-model.md
├── api.md
└── decisions.md

Documentar especialmente:

architecture.md

Qué hace cada capa.

data-model.md

Relaciones entre entidades.

prediction-model.md

Fórmulas utilizadas.

decisions.md

Por qué:

FastAPI
Next.js
Supabase
R3F
deterministic model
synthetic dataset
39. ESTRUCTURA DE REPOSITORIO

Construye inicialmente:

ceres/
│
├── apps/
│   ├── api/
│   │   ├── app/
│   │   │   ├── api/
│   │   │   ├── core/
│   │   │   │   └── prediction/
│   │   │   ├── models/
│   │   │   ├── schemas/
│   │   │   ├── services/
│   │   │   └── main.py
│   │   ├── tests/
│   │   └── requirements.txt
│   │
│   └── web/
│       ├── app/
│       ├── components/
│       │   ├── terrain/
│       │   ├── cells/
│       │   └── dashboard/
│       ├── store/
│       ├── lib/
│       └── types/
│
├── database/
│   ├── migrations/
│   └── seeds/
│
├── scripts/
│   └── generate_demo_data.py
│
├── docs/
│   ├── architecture.md
│   ├── data-model.md
│   ├── prediction-model.md
│   ├── api.md
│   └── decisions.md
│
├── tests/
│
├── .env.example
├── README.md
└── docker-compose.yml

Si detectas que otra estructura es claramente mejor para este MVP, puedes modificarla, pero explica la decisión antes de hacer cambios importantes.

40. ORDEN EXACTO DE CONSTRUCCIÓN

Quiero que sigas este orden.

FASE 0 — INSPECCIÓN

Antes de escribir código:

inspecciona el repositorio actual
identifica qué existe
identifica archivos incompletos
identifica configuraciones existentes
no sobrescribas trabajo útil
presenta brevemente el plan de implementación

NO empieces a programar hasta haber entendido el estado actual del repositorio.

FASE 1 — DOMAIN MODEL

Construye primero:

models
schemas
types

Define:

Farm
Plot
Crop
CropCycle
GridCell
Prediction
Observation
Harvest
FASE 2 — DATABASE

Crear:

migrations
seeds

Crear dataset sintético reproducible.

FASE 3 — PREDICTION ENGINE

Implementar:

predict()

Sin FastAPI.

Escribir tests.

El motor debe funcionar completamente aislado.

FASE 4 — FASTAPI

Crear endpoints.

Probar con:

Swagger
curl
pytest

No avanzar si la API no funciona correctamente.

FASE 5 — FRONTEND 2D

Construir dashboard mínimo.

Grid 20×20.

Click → prediction.

FASE 6 — INTEGRACIÓN

Conectar:

Next.js
   ↓
FastAPI
   ↓
Prediction Engine
   ↓
Supabase
FASE 7 — 3D

Reemplazar la representación 2D por:

React Three Fiber

Implementar:

terrain
grid
raycasting
hover
selection
FASE 8 — OBSERVATIONS

Agregar:

create observation
list observations
visualize observation
FASE 9 — HARVEST

Agregar:

register harvest
compare prediction
calculate error
FASE 10 — TRACKING

Agregar:

prediction history
harvest history
prediction vs actual
41. QUÉ NO HACER TODAVÍA

No implementar:

satellite imagery
real weather APIs
IoT
drone imagery
computer vision
LLM
deep learning
real-time streaming
Kafka
Redis
Kubernetes
microservices
multi-region deployment
advanced PostGIS
billing
complex permissions
mobile app

Todo eso pertenece a fases futuras.

El objetivo actual es probar:

¿Podemos representar una finca como un Digital Twin espacial y cerrar el ciclo predicción → observación → cosecha → validación?

42. FUTURO, PERO NO IMPLEMENTAR

La arquitectura debe dejar espacio para:

Real terrain data
        ↓
Satellite imagery
        ↓
Weather
        ↓
Soil sensors
        ↓
Observations
        ↓
ML

Y eventualmente:

Rule-based Engine
       ↓
Statistical Model
       ↓
Machine Learning
       ↓
Adaptive Digital Twin

Pero NO implementar esto todavía.

43. CRITERIO DE ÉXITO DEL MVP

Consideraremos que CERES MVP funciona cuando pueda hacer esto:

Paso 1

Usuario entra al dashboard.

Paso 2

Selecciona:

Farm
→ Plot
→ Crop Cycle
Paso 3

Ve:

20 × 20 grid
Paso 4

Hace click en una celda.

Paso 5

CERES obtiene:

cell_id
Paso 6

Frontend solicita:

POST /api/v1/predictions
Paso 7

Backend ejecuta:

Prediction Engine
Paso 8

Devuelve:

yield
boxes
loss
risk
factors
model_version
Paso 9

Frontend muestra los resultados.

Paso 10

Usuario registra:

observation
Paso 11

Después registra:

actual harvest
Paso 12

CERES muestra:

Predicted
vs
Actual
Paso 13

CERES calcula:

error %

Si todo esto funciona, tenemos un MVP válido.

44. CALIDAD DEL CÓDIGO

Prioriza:

tipos claros
funciones pequeñas
responsabilidades separadas
nombres descriptivos
validación
errores explícitos
tests
documentación
configuración mediante .env
no hardcodear secretos

Evita:

funciones gigantes
lógica duplicada
código muerto
magic numbers sin explicación
lógica agrícola dentro de React
consultas SQL dispersas por todo el backend
datos falsos hardcodeados dentro de componentes
45. REGLA SOBRE DATOS SINTÉTICOS

Debes marcar claramente en el código y README:

DEMO / SYNTHETIC DATA

No presentar las predicciones como datos agrícolas reales.

La finca es ficticia.

Los valores son para validación técnica.

46. REGLA SOBRE EL MODELO

No afirmar:

"CERES predice realmente el rendimiento agrícola."

Durante el MVP decir:

"CERES prototype estimates yield using a deterministic synthetic model."

Hasta que existan datos reales y validación experimental.

47. DESARROLLO ITERATIVO

Después de cada fase:

ejecutar tests
verificar que el sistema arranca
comprobar el flujo
revisar errores
documentar cambios
hacer commit

Usa commits pequeños y descriptivos.

Ejemplos:

feat: create agricultural domain models
feat: add synthetic farm generator
feat: implement deterministic prediction engine
test: add prediction engine coverage
feat: expose prediction API
feat: add 2D farm grid
feat: integrate cell selection
feat: add R3F terrain
feat: add field observations
feat: add harvest tracking
48. MUY IMPORTANTE: NO SOBREINGENIERIZAR

Este es un MVP.

Si una solución sencilla funciona:

ÚSALA.

No crear abstracciones únicamente para demostrar arquitectura.

La arquitectura debe ser suficientemente limpia para poder evolucionar, pero el objetivo principal es:

WORKING END-TO-END SYSTEM
49. TU PRIMERA TAREA

Empieza únicamente por:

FASE 0 + FASE 1

Haz:

1. inspección del repositorio
2. arquitectura inicial
3. estructura de carpetas
4. domain models
5. schemas
6. tipos

NO construyas todavía:

dashboard
3D
shaders
autenticación
ML
observaciones
cosechas

Cuando termines esa fase, muéstrame:

estructura de archivos
domain model
relaciones
decisiones arquitectónicas

y continúa después con la FASE 2.

50. PRINCIPIO FINAL

Quiero que construyas CERES siguiendo esta filosofía:

              CERES
                │
                ▼
        DIGITAL TWIN CORE
                │
        ┌───────┴────────┐
        ▼                ▼
      SPACE           DATA
        │                │
        └───────┬────────┘
                ▼
           PREDICTION
                │
                ▼
          VISUALIZATION
                │
                ▼
          OBSERVATIONS
                │
                ▼
             HARVEST
                │
                ▼
          VALIDATION
                │
                ▼
         MODEL IMPROVEMENT

El 3D es una representación del sistema.

El verdadero producto es el ciclo:

STATE → PREDICT → OBSERVE → HARVEST → VALIDATE

Construye primero ese núcleo.

No quiero una demo bonita que no tenga cerebro.

Quiero un MVP pequeño, funcional, explicable, reproducible y con una arquitectura que posteriormente pueda evolucionar hacia un verdadero Digital Twin agrícola.