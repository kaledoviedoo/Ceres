"""Lo que la base de datos guardaba y la API no contaba.

Tres campos llevaban tiempo escribiendose y no salian por ninguna respuesta:
`Prediction.inputs`, `Observation.created_by` y `Harvest.created_by`. No es una
funcionalidad nueva —el dato ya estaba—, es dejar de esconderlo.

`inputs` es el que importa para el historico. Dos predicciones de la misma celda
pueden diferir porque cambio el modelo o porque cambio el terreno, y `factors`
sola no distingue los dos casos: son multiplicadores ya aplicados. Con las
entradas guardadas, cada punto de la serie es reproducible.
"""

from __future__ import annotations


def crear(client, cell_id, crop_cycle_id):
    return client.post(
        "/api/v1/predictions",
        json={"cell_id": str(cell_id), "crop_cycle_id": str(crop_cycle_id)},
    )


def test_a_saved_prediction_carries_the_inputs_it_ran_with(client, cell_id, crop_cycle_id):
    creada = crear(client, cell_id, crop_cycle_id).json()

    assert "inputs" in creada, "la prediccion no dice con que entradas se ejecuto"
    assert creada["inputs"], "las entradas llegan vacias"


def test_the_inputs_are_the_real_state_of_the_cell(client, cell_id, crop_cycle_id):
    """No es un diccionario decorativo: son los numeros de la celda.

    Se comprueba contra `GET /cells/{id}`, que es de donde salieron.
    """
    celda = client.get(f"/api/v1/cells/{cell_id}").json()
    inputs = crear(client, cell_id, crop_cycle_id).json()["inputs"]

    for campo in ("elevation_m", "slope_deg", "soil_quality", "health_factor"):
        assert campo in inputs, f"`{campo}` no viaja en las entradas"
        assert inputs[campo] == celda[campo], campo


def test_the_history_endpoint_keeps_everything_needed_to_read_a_series(
    client, cell_id, crop_cycle_id
):
    """La lista de campos que hace legible una serie temporal.

    `created_by` NO esta, y es un hallazgo, no un olvido: la tabla
    `predictions` no tiene columna de autor —`observations` y `harvests` si—.
    Publicarla vacia anunciaria una columna inexistente, y ademas hoy nada
    podria rellenarla porque no hay autenticacion.
    """
    crear(client, cell_id, crop_cycle_id)
    historico = client.get(f"/api/v1/cells/{cell_id}/predictions").json()

    assert historico["predictions"], "el historico no devuelve la prediccion recien creada"
    entrada = historico["predictions"][0]

    for campo in ("model_version", "factors", "inputs", "created_at"):
        assert campo in entrada, f"el historico pierde `{campo}`"

    assert "created_by" not in entrada, (
        "se esta publicando un autor que la tabla `predictions` no guarda"
    )


def test_two_predictions_are_two_points_with_their_own_inputs(
    client, cell_id, crop_cycle_id
):
    """Cada ejecucion es una fotografia independiente, no una actualizacion."""
    crear(client, cell_id, crop_cycle_id)
    crear(client, cell_id, crop_cycle_id)

    predicciones = client.get(f"/api/v1/cells/{cell_id}/predictions").json()["predictions"]

    assert len(predicciones) == 2
    assert predicciones[0]["id"] != predicciones[1]["id"]
    for p in predicciones:
        assert p["inputs"]


def test_observations_say_who_registered_them(client, cell_id):
    """Una observacion de campo la firma alguien.

    Sin autor no se distingue un dato levantado por un agronomo de uno cargado
    por un proceso, y esa diferencia es toda la diferencia.
    """
    observaciones = client.get(f"/api/v1/cells/{cell_id}/observations").json()

    # El dataset puede no tener observaciones en ESTA celda; lo que se fija es
    # el contrato, asi que se comprueba sobre las que haya.
    for observacion in observaciones:
        assert "created_by" in observacion


def test_the_observation_schema_declares_the_author():
    """Y si la celda de prueba no tiene ninguna, el schema sigue teniendo que declararlo."""
    from app.schemas.observation import ObservationRead

    assert "created_by" in ObservationRead.model_fields


def test_the_harvest_schema_declares_the_author():
    from app.schemas.harvest import HarvestRead

    assert "created_by" in HarvestRead.model_fields
