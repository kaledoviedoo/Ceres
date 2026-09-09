"use client";

/**
 * Qué capa se proyecta sobre el terreno.
 *
 * Sustituye a DOS conmutadores que hacían la misma pregunta partida en dos:
 * «Campo o Análisis» y luego «Riesgo, Rendimiento o Pérdida». Eran un solo eje
 * —qué estoy mirando encima de este campo— y tenerlo repartido obligaba a
 * combinar mentalmente dos controles para llegar a una vista. Ahora es una
 * lista: la capa activa es una y se lee de un vistazo.
 *
 * LAS CAPAS QUE FALTAN SE NOMBRAN, Y SE DICE POR QUÉ NO ESTÁN
 * Esconderlas dejaría la arquitectura invisible; ponerlas como botones
 * apagados prometería algo que no existe todavía. Van en una línea al pie, sin
 * forma de control. El motivo de cada una está en su `title`, y no es siempre
 * el mismo: de suelo y sanidad la API SI devuelve dato completo, así que decir
 * «sin fuente» habría sido falso.
 */

import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { availableLayers, pendingLayers, type LayerId } from "@/lib/terrain/layers";

const AVAILABLE = availableLayers();
const PENDING = pendingLayers();

interface LayerSwitchProps {
  value: LayerId;
  onChange: (id: LayerId) => void;
}

export function LayerSwitch({ value, onChange }: LayerSwitchProps) {
  return (
    <div className="floating rounded-xl px-2.5 pb-2 pt-2">
      <SegmentedControl
        options={AVAILABLE.map((layer) => ({
          id: layer.id,
          label: layer.label,
          // La pregunta y no la descripción: un botón rotulado "Suelo" ya dice
          // qué campo es, y lo que no dice es para qué sirve mirarlo.
          hint: `${layer.question}
${layer.reads.low} → ${layer.reads.high}
${layer.source}`,
        }))}
        value={value}
        onChange={onChange}
        label="Capa que se proyecta sobre el terreno"
      />

      {PENDING.length > 0 && (
        <p className="mt-1.5 px-1 text-[10px] leading-tight text-muted">
          <span className="text-faint">Todavía no son capas: </span>
          {PENDING.map((layer, i) => (
            <span key={layer.id} title={layer.missing}>
              {i > 0 && " · "}
              {layer.label}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
