"use client";

/**
 * Contenedor de la representación del terreno.
 *
 * ES EL PUNTO DE SUSTITUCIÓN. Decide qué vista se monta —relieve 3D o malla
 * plana— y traduce store ↔ props. Cambiar de una a otra es cambiar una rama de
 * este archivo: `page.tsx`, el Cell Inspector, el cliente de API y el motor no
 * se enteran, porque ambas vistas cumplen el mismo contrato estrecho.
 *
 * También aísla el repintado. Se suscribe a la selección y al modo con
 * selectores individuales, así que cambiar de celda no toca el selector de
 * lote ni el panel del lado.
 *
 * El hover no aparece por ninguna parte: cada vista lo resuelve por dentro.
 */

import { CellGrid } from "@/components/terrain/CellGrid";
import { TerrainCanvas } from "@/components/terrain/TerrainCanvas";
import type { PlotGrid } from "@/lib/terrain/coords";
import type { ElevationField } from "@/lib/terrain/elevation";
import type { TerrainCell } from "@/lib/terrain/types";
import { getAvailableLayer } from "@/lib/terrain/layers";
import { useCeresStore } from "@/stores/useCeresStore";

interface TerrainViewProps {
  /** Rama geométrica. `null` mientras no hay datos. */
  field: ElevationField | null;
  cells: TerrainCell[];
  /**
   * La malla física del lote. Un solo objeto y no tres props sueltas: el lado de
   * la celda viaja pegado a las dimensiones, así que no hay forma de pasar unas
   * y olvidar el otro.
   */
  plot: PlotGrid;
}

export function TerrainView({ field, cells, plot }: TerrainViewProps) {
  const terrainMode = useCeresStore((state) => state.terrainMode);
  const activeLayerId = useCeresStore((state) => state.activeLayerId);
  const selectedCellId = useCeresStore((state) => state.selectedCellId);
  const selectCell = useCeresStore((state) => state.selectCell);

  // La MISMA capa alimenta las dos proyecciones. Es lo que hace que planta y
  // relieve no puedan discrepar sobre qué se está mirando.
  const layer = getAvailableLayer(activeLayerId);

  if (terrainMode === "2d") {
    // La malla se centra en el hueco que queda LIBRE, no en el lienzo entero.
    // Centrada sobre todo el ancho, sus dos ultimas columnas y la etiqueta
    // "Este" quedaban bajo el inspector, y el borde inferior bajo las franjas
    // del pie: informacion tapada, que es justo lo que el panel no debe hacer.
    //
    // El hueco se reserva SIEMPRE, haya celda abierta o no. Reservarlo solo al
    // seleccionar haria saltar la malla entera bajo el cursor en el momento de
    // hacer clic.
    return (
      <div className="flex h-full w-full items-center justify-center overflow-auto p-8 pt-[4.5rem] pb-[calc(45dvh+8rem)] md:pb-[calc(45dvh+5.5rem)] lg:pb-[11rem] lg:pr-[22rem] xl:pr-[24rem] 2xl:pr-[26rem]">
        {/* Ancho explicito: dentro de un flex centrado, el `w-full` de la malla
            no tendria de que agarrarse y se colapsaria a su contenido.

            El alto de la malla lo dicta su ancho —las celdas son cuadradas—, asi
            que el ancho es lo unico que se puede acotar. Se acota por la altura
            que queda libre despues de reservar franja, conmutadores y hoja —y
            descontando las etiquetas de orientacion, que van fuera de la malla
            pero dentro del bloque—. La reserva crece por debajo de `md`,
            donde los dos conmutadores se apilan en dos filas; si no, en pantalla
            estrecha la malla salia por arriba de la ventana y esa parte no se
            podia recuperar ni desplazando (un hijo centrado que desborda recorta
            por el borde de inicio). */}
        <div className="w-full max-w-[min(680px,calc(55dvh-14.5rem))] shrink-0 md:max-w-[min(680px,calc(55dvh-12rem))] lg:max-w-[min(680px,calc(100dvh-17.5rem))]">
        <CellGrid
          cells={cells}
          gridWidth={plot.width}
          gridHeight={plot.height}
          layer={layer}
          selectedCellId={selectedCellId}
          onSelect={selectCell}
        />
        </div>
      </div>
    );
  }

  // Sin campo de elevación no hay geometría que construir.
  if (!field) return null;

  return (
    <TerrainCanvas
      field={field}
      cells={cells}
      plot={plot}
      layer={layer}
      selectedCellId={selectedCellId}
      onSelect={selectCell}
    />
  );
}
