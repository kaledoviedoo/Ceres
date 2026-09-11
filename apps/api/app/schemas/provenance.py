"""Contrato de API: de donde sale cada grupo de campos de una celda.

Va a nivel de LOTE y no de celda. La procedencia es una propiedad de la fuente,
no del dato individual: las 400 celdas del lote vienen del mismo sitio, y
repetir el bloque cuatrocientas veces multiplicaria el payload sin anadir ni un
bit de informacion.

Se divide en cuatro grupos porque son cuatro procedencias distintas y mezclarlas
seria justo lo que este bloque existe para evitar:

    dataset     que es todo esto, en conjunto.
    elevation   `elevation_m`. Es la que construye la geometria del terreno.
    slope       `slope_deg`. Es la unica DERIVADA de otro campo de la respuesta.
    agronomic   suelo, densidad, sanidad y factor residual. Entradas del motor.
"""

from __future__ import annotations

from pydantic import Field

from app.domain.enums import Provenance
from app.schemas.common import CeresORMSchema


class DatasetProvenance(CeresORMSchema):
    """El conjunto de datos, visto de lejos."""

    kind: Provenance = Field(
        default=Provenance.UNKNOWN,
        description="Vocabulario cerrado. `unknown` si el sistema no puede respaldar otra cosa",
    )
    #: Que produjo el dataset. Un modulo importable, para que la afirmacion sea
    #: verificable en vez de tener que creerla.
    generator: str | None = Field(
        default=None, description="Modulo que genero los datos, si los genero alguno"
    )
    note: str = Field(description="La misma advertencia que sirve /health, en prosa")
    #: QUE SIGNIFICA LA MALLA. Existe porque 40.000 celdas de 1 m2 se leen solas
    #: como "tenemos informacion de cada metro cuadrado", y eso es falso: la
    #: resolucion NOMINAL es de 1 m pero la EFECTIVA es de decenas de metros
    #: (ver `elevation.effective_resolution_m`). Las dos cifras ya viajaban en la
    #: respuesta; esta frase dice en voz alta lo que su diferencia significa,
    #: para que un cliente no tenga que deducirlo dividiendo.
    representation: str = Field(
        description="Que representa la malla, en una frase que se pueda citar"
    )


class ElevationProvenance(CeresORMSchema):
    """`elevation_m`, que es lo unico que puede mover un vertice del terreno."""

    kind: Provenance = Field(default=Provenance.UNKNOWN)
    field_name: str = Field(default="elevation_m")
    units: str = Field(default="m")
    #: Separacion entre muestras almacenadas. Esta fuente guarda una por celda,
    #: asi que coincide con `cell_size_m` — no por definicion, sino porque es
    #: donde estan las muestras.
    nominal_resolution_m: float = Field(gt=0)
    #: A que escala varia el campo DE VERDAD. Es otra cosa que la nominal y no
    #: se deduce de ella: sale de medir el campo. `null` cuando no se ha medido.
    effective_resolution_m: float | None = Field(default=None)
    #: Respecto a que se miden las alturas. `unknown` mientras nadie lo declare:
    #: elipsoidal y ortometrico difieren decenas de metros.
    vertical_datum: str = Field(default="unknown")
    method: str | None = Field(default=None, description="Como se produjo, si se produjo")


class SlopeProvenance(CeresORMSchema):
    """`slope_deg`. Tener el campo completo no es tenerlo medido."""

    kind: Provenance = Field(default=Provenance.UNKNOWN)
    field_name: str = Field(default="slope_deg")
    units: str = Field(default="deg")
    #: De que campos de ESTA misma respuesta se calculo. Es lo que permite a un
    #: cliente saber que no es una observacion independiente.
    derived_from: list[str] = Field(default_factory=list)
    method: str | None = Field(default=None)


class AgronomicProvenance(CeresORMSchema):
    """Suelo, densidad, sanidad y factor residual: las entradas del motor."""

    kind: Provenance = Field(default=Provenance.UNKNOWN)
    field_names: list[str] = Field(default_factory=list)
    method: str | None = Field(default=None)


class CellProvenance(CeresORMSchema):
    """El bloque completo que viaja con las celdas de un lote."""

    dataset: DatasetProvenance
    elevation: ElevationProvenance
    slope: SlopeProvenance
    agronomic: AgronomicProvenance
