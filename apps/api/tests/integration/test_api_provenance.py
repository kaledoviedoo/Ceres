"""Contrato de procedencia: la API tiene que decir de donde salen sus datos.

Estos tests existen porque durante varias fases el frontend SUPUSO la
procedencia. Tenia una constante llamada `ASSUMED_PROVENANCE` que afirmaba
"elevacion sintetica" pasara lo que pasara, y la afirmacion era correcta por
casualidad: nadie se la habia dicho.

Lo que se fija aqui:

  1. que el bloque exista;
  2. que nunca aparezca `measured` mientras el dataset lo genere un generador;
  3. que la esquina del origen se declare en vez de quedarse en una frase;
  4. que lo derivado se declare derivado.
"""

from __future__ import annotations

import pytest

from app.core import provenance as declarado
from app.domain.enums import Provenance

GRUPOS = ("dataset", "elevation", "slope", "agronomic")


@pytest.fixture
def plot_id(client):
    farms = client.get("/api/v1/farms").json()
    farm = client.get(f"/api/v1/farms/{farms[0]['id']}").json()
    return farm["plots"][0]["id"]


def test_cells_carry_a_provenance_block(client, plot_id):
    """Sin esto, un cliente solo puede inventarse de donde vienen los numeros."""
    body = client.get(f"/api/v1/plots/{plot_id}/cells").json()

    assert "provenance" in body, "las celdas se sirven sin decir de donde salen"
    for grupo in GRUPOS:
        assert grupo in body["provenance"], f"falta el grupo `{grupo}`"


def test_every_group_uses_the_closed_vocabulary(client, plot_id):
    """Cinco palabras y ninguna mas: un cliente no deberia interpretar prosa."""
    permitido = {p.value for p in Provenance}
    provenance = client.get(f"/api/v1/plots/{plot_id}/cells").json()["provenance"]

    for grupo in GRUPOS:
        assert provenance[grupo]["kind"] in permitido, grupo


def test_nothing_is_measured_while_the_dataset_is_generated(client, plot_id):
    """EL TEST QUE MAS IMPORTA.

    `measured` significa que alguien salio al campo con un instrumento. Mientras
    el dataset lo produzca `app.core.synthetic`, ningun grupo puede reclamarlo:
    seria la unica mentira de todo el contrato que un cliente no podria detectar.
    """
    assert declarado.DATASET_KIND is Provenance.SYNTHETIC, (
        "si este despliegue ya sirve datos medidos, este test debe cambiar a "
        "conciencia y no por costumbre"
    )

    provenance = client.get(f"/api/v1/plots/{plot_id}/cells").json()["provenance"]
    for grupo in GRUPOS:
        assert provenance[grupo]["kind"] != Provenance.MEASURED.value, (
            f"`{grupo}` se declara medido sobre un dataset generado"
        )


def test_unknown_is_the_default_never_measured():
    """El valor por omision de cada campo del schema.

    Se comprueba sobre los schemas y no sobre la respuesta: lo que se quiere
    fijar es que construir un bloque a medias produzca `unknown`, no que la
    respuesta de hoy lo tenga.
    """
    from app.schemas.provenance import (
        AgronomicProvenance,
        DatasetProvenance,
        ElevationProvenance,
        SlopeProvenance,
    )

    # `note` y `representation` son obligatorios a proposito: son las dos frases
    # que un cliente puede citar, y un bloque de procedencia sin ellas seria
    # justo lo que este modulo existe para impedir. Lo que tiene defecto es el
    # VOCABULARIO, y su defecto es `unknown`.
    assert DatasetProvenance(note="x", representation="y").kind is Provenance.UNKNOWN
    assert ElevationProvenance(nominal_resolution_m=1.0).kind is Provenance.UNKNOWN
    assert SlopeProvenance().kind is Provenance.UNKNOWN
    assert AgronomicProvenance().kind is Provenance.UNKNOWN


def test_slope_is_declared_derived_and_says_from_what(client, plot_id):
    """Tener el campo completo no es tenerlo medido.

    `slope_deg` llega 400/400 y lo calcula `numpy.gradient` sobre la elevacion.
    Un cliente tiene que poder saber que no es una observacion independiente
    antes de pintarla como si lo fuera.
    """
    slope = client.get(f"/api/v1/plots/{plot_id}/cells").json()["provenance"]["slope"]

    assert slope["kind"] == Provenance.DERIVED.value
    assert "elevation_m" in slope["derived_from"]
    assert slope["method"]


def test_elevation_separates_nominal_from_effective_resolution(client, plot_id):
    """Son dos numeros distintos y confundirlos finge precision.

    La nominal es donde estan las muestras —una por celda—. La efectiva es a que
    escala varia el campo de verdad, y es peor.
    """
    body = client.get(f"/api/v1/plots/{plot_id}/cells").json()
    elevation = body["provenance"]["elevation"]

    assert elevation["nominal_resolution_m"] == body["cell_size_m"]
    assert elevation["effective_resolution_m"] > elevation["nominal_resolution_m"]
    # Nadie ha declarado sobre que geoide se miden estas alturas.
    assert elevation["vertical_datum"] == "unknown"


def test_plot_declares_which_corner_the_origin_is(client, plot_id):
    """Suponer el centro en vez de la esquina desplaza el lote medio lote.

    Y no da ningun error: los numeros siguen siendo grados validos.
    """
    plot = client.get(f"/api/v1/plots/{plot_id}").json()

    assert "origin_corner" in plot, "el origen no dice a que esquina se refiere"
    assert plot["origin_corner"] == "southwest"


def test_the_disclaimer_and_the_provenance_say_the_same_thing(client, plot_id):
    """Una sola fuente para las dos formas de decirlo.

    Antes la frase de `/health` y la naturaleza del dataset eran dos
    afirmaciones independientes que podian divergir sin que nadie lo notara.
    """
    health = client.get("/api/v1/health").json()
    dataset = client.get(f"/api/v1/plots/{plot_id}/cells").json()["provenance"]["dataset"]

    assert dataset["note"] == health["disclaimer"]
    assert dataset["generator"] == declarado.DATASET_GENERATOR


def test_the_dataset_says_what_the_grid_represents(client, plot_id):
    """La frase que impide leer 40.000 celdas como 40.000 mediciones.

    Las dos cifras --nominal y efectiva-- ya viajaban por separado en
    `elevation`. Esto dice en voz alta lo que su diferencia significa, para que
    un cliente no tenga que deducirlo dividiendo.
    """
    bloque = client.get(f"/api/v1/plots/{plot_id}/cells").json()["provenance"]
    frase = bloque["dataset"]["representation"]

    assert frase
    assert "1 m" in frase
    assert "sintetico" in frase.lower()
    # Y no promete lo que no hay.
    assert "medida de cada metro" in frase or "no 40.000 mediciones" in frase


def test_the_nominal_and_effective_resolutions_do_not_agree_and_that_is_the_point(
    client, plot_id
):
    """Si algun dia coincidieran, la frase de arriba sobraria. Hoy no coinciden.

    Es la razon de que exista: una malla de 1 m sobre un campo cuyo detalle real
    esta a decenas de metros son unidades de REPRESENTACION, no de medicion.
    """
    elevacion = client.get(f"/api/v1/plots/{plot_id}/cells").json()["provenance"]["elevation"]

    assert elevacion["effective_resolution_m"] > elevacion["nominal_resolution_m"]
