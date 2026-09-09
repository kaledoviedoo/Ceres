"""Tres respuestas declaran `cell_size_m`. No pueden decir cosas distintas.

`GET /plots/{id}`, `GET /plots/{id}/cells` y `GET /plots/{id}/overview` traen las
tres el lado de la celda. Desde que la geometria del frontend depende de ese
numero, una discrepancia entre ellas no seria un detalle: pintaria el lote a otra
escala segun por que endpoint hubiera entrado el dato.

Se comprueba AQUI, del lado del servidor, y no en tres componentes del cliente.
Las tres cifras salen de la misma fila de `plots`, asi que si alguna vez
divergen sera por un cambio en el backend, y es donde tiene que fallar.
"""

from __future__ import annotations

import pytest


@pytest.fixture
def plot(client):
    farms = client.get("/api/v1/farms").json()
    farm = client.get(f"/api/v1/farms/{farms[0]['id']}").json()
    return farm["plots"][0]


def _respuestas(client, plot_id):
    ciclo = client.get(f"/api/v1/plots/{plot_id}/crop-cycles").json()[0]["id"]
    return {
        "plot": client.get(f"/api/v1/plots/{plot_id}").json(),
        "cells": client.get(f"/api/v1/plots/{plot_id}/cells").json(),
        "overview": client.get(
            f"/api/v1/plots/{plot_id}/overview", params={"crop_cycle_id": ciclo}
        ).json(),
    }


def test_the_three_endpoints_agree_on_the_cell_size(client, plot):
    tamanos = {
        nombre: cuerpo["cell_size_m"]
        for nombre, cuerpo in _respuestas(client, plot["id"]).items()
    }

    assert len(set(tamanos.values())) == 1, f"discrepan: {tamanos}"


def test_the_three_endpoints_agree_on_the_grid(client, plot):
    """Las dimensiones tambien: media malla desplazada tampoco da error."""
    respuestas = _respuestas(client, plot["id"])
    for eje in ("grid_width", "grid_height"):
        valores = {n: c[eje] for n, c in respuestas.items()}
        assert len(set(valores.values())) == 1, f"{eje} discrepa: {valores}"


def test_the_cell_count_matches_the_cells_actually_served(client, plot):
    cuerpo = client.get(f"/api/v1/plots/{plot['id']}/cells").json()

    assert len(cuerpo["cells"]) == cuerpo["grid_width"] * cuerpo["grid_height"]


def test_the_area_is_the_grid_times_the_cell_squared(client, plot):
    """La identidad que hace imposible una discrepancia.

    `area_m2` es un `computed_field` de `PlotRead`: se calcula como
    `cell_count * cell_size_m**2` en el momento de serializar. No es una columna
    que alguien pudiera haber dejado desactualizada.

    Este test lo CONVIERTE en contrato: si manana `area_m2` pasara a ser un dato
    almacenado, la identidad seguiria teniendo que cumplirse o esto se cae.
    """
    esperado = plot["grid_width"] * plot["grid_height"] * plot["cell_size_m"] ** 2

    assert plot["area_m2"] == pytest.approx(esperado, rel=1e-9)
    assert plot["cell_count"] == plot["grid_width"] * plot["grid_height"]


def test_the_nominal_elevation_resolution_follows_the_cell_size(client, plot):
    """La procedencia no puede contradecir a la malla.

    La fuente guarda una muestra de elevacion por celda, asi que su resolucion
    nominal ES el lado de la celda. Si alguien fijara ahi un 1.0 constante, un
    lote de celdas de medio metro anunciaria el doble de espaciado del que tiene.
    """
    cuerpo = client.get(f"/api/v1/plots/{plot['id']}/cells").json()

    assert (
        cuerpo["provenance"]["elevation"]["nominal_resolution_m"] == cuerpo["cell_size_m"]
    )
