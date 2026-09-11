"""Construccion del bloque de procedencia.

Vive en el servicio y no en el router por la misma razon que el resto: el router
traduce HTTP y el servicio decide que es verdad. Y vive en el servicio y no en
una migracion porque hoy la procedencia es una propiedad de la FUENTE del
dataset, no de cada fila: no hay nada que guardar por celda que no sea la misma
frase repetida cuatrocientas veces.

Todo lo que se afirma aqui sale de `app.core.provenance`, que es donde esta
escrito lo que este despliegue puede respaldar. Este modulo no sabe nada; solo
da forma.
"""

from __future__ import annotations

from app.core import provenance as declarado
from app.domain.enums import Provenance
from app.models import Plot
from app.schemas.provenance import (
    AgronomicProvenance,
    CellProvenance,
    DatasetProvenance,
    ElevationProvenance,
    SlopeProvenance,
)


def build_cell_provenance(plot: Plot) -> CellProvenance:
    """La procedencia de las celdas de un lote.

    Recibe el lote porque una sola cifra depende de el: la resolucion nominal de
    la elevacion, que es donde estan las muestras —una por celda—. Todo lo demas
    es la declaracion del despliegue.
    """
    # Que generador escribio ESTAS celdas. Hay dos en el despliegue y no
    # producen el mismo terreno: atribuir las celdas de una finca al generador
    # de la otra serviria una resolucion efectiva veinticinco veces mayor que la
    # real. Ver `app.core.provenance.source_for_farm`.
    fuente = declarado.source_for_farm(plot.farm_id)

    # `generator` solo se nombra cuando de verdad hubo uno. Con datos medidos
    # no habria modulo que citar y el campo se queda en `null`.
    generado = fuente.kind is Provenance.SYNTHETIC

    return CellProvenance(
        dataset=DatasetProvenance(
            kind=fuente.kind,
            generator=fuente.generator if generado else None,
            note=declarado.DISCLAIMER,
            representation=fuente.representation,
        ),
        elevation=ElevationProvenance(
            kind=fuente.kind,
            nominal_resolution_m=plot.cell_size_m,
            effective_resolution_m=fuente.elevation_effective_resolution_m,
            vertical_datum=declarado.ELEVATION_VERTICAL_DATUM,
            method=fuente.elevation_method,
        ),
        # La pendiente NO hereda la procedencia del dataset: es `derived` pase lo
        # que pase, porque el backend la calcula de la elevacion en vez de
        # recibirla. Si manana la elevacion fuera un DEM medido, la pendiente
        # seguiria siendo derivada —de una medicion, eso si—.
        slope=SlopeProvenance(
            kind=Provenance.DERIVED,
            derived_from=list(declarado.SLOPE_DERIVED_FROM),
            method=declarado.SLOPE_METHOD,
        ),
        agronomic=AgronomicProvenance(
            kind=fuente.kind,
            field_names=list(declarado.AGRONOMIC_FIELDS),
            method=fuente.agronomic_method,
        ),
    )
