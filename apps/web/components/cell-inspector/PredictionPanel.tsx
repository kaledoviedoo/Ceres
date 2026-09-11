"use client";

/**
 * Predicción persistida de una celda.
 *
 * Aquí es donde `POST /api/v1/predictions` se ejecuta de verdad: el resto de la
 * pantalla trabaja con las métricas calculadas al vuelo del overview, y solo
 * este botón escribe una fila en la base de datos.
 *
 * La diferencia importa y la interfaz la hace explícita: guardar una predicción
 * es un acto deliberado que queda en el histórico con su fecha y su versión de
 * modelo, no un efecto secundario de mirar el mapa.
 */

import { useEffect, useRef, useState } from "react";

import { MetricGroup, MetricRow } from "@/components/cell-inspector/MetricRow";
import { RiskBadge, Tag } from "@/components/ui/Badge";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";
import { ceresApi } from "@/lib/api/endpoints";
import { describeError } from "@/lib/api/useApiResource";
import {
  formatDateTime,
  formatFactorDelta,
  formatInteger,
  formatKg,
  formatPercent,
  formatScore,
  formatTons,
} from "@/lib/presentation/format";
import type { Prediction } from "@/lib/types/api";

const FACTOR_LABELS: Record<keyof Prediction["factors"], string> = {
  density_factor: "Densidad",
  soil_factor: "Suelo",
  health_factor: "Sanidad",
  terrain_factor: "Terreno",
  base_yield_factor: "Residual",
};

interface PredictionPanelProps {
  cellId: string;
  cropCycleId: string | null;
  /**
   * El instante que se está mirando, para que lo guardado coincida con lo visto.
   *
   * `null` deja que la API use "ahora", que es lo que hacía siempre.
   */
  asOf: string | null;
  /**
   * Se llama cuando el POST ha guardado de verdad. Solo entonces: un fallo no
   * cambia nada en el servidor y no hay nada nuevo que leer.
   *
   * Este panel es el único sitio que escribe, pero lo que depende de esa
   * escritura —el histórico, la predicción contra la cosecha— lo posee el
   * inspector. Sin este aviso, esos bloques seguían enseñando la lista y la
   * entrada anteriores hasta que el usuario salía de la celda y volvía.
   */
  onSaved: () => void;
}

export function PredictionPanel({ cellId, cropCycleId, asOf, onSaved }: PredictionPanelProps) {
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El panel se remonta al cambiar de celda. Si el POST de la celda anterior
  // responde cuando ya se mira otra, no tiene a quién avisar: la escritura
  // ocurrió y la celda anterior la enseñará cuando se vuelva a abrir. Avisar
  // igualmente obligaría a la celda nueva a pedirse otra vez sin motivo.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function runPrediction() {
    if (!cropCycleId) return;
    setIsRunning(true);
    setError(null);
    try {
      const saved = await ceresApi.createPrediction({
        cell_id: cellId,
        crop_cycle_id: cropCycleId,
        ...(asOf ? { as_of: asOf } : {}),
      });
      if (!mounted.current) return;
      setPrediction(saved);
      onSaved();
    } catch (cause) {
      if (!mounted.current) return;
      setError(describeError(cause));
    } finally {
      if (mounted.current) setIsRunning(false);
    }
  }

  if (!cropCycleId) {
    return (
      <p className="text-xs text-muted">
        Este lote no tiene ningún ciclo de cultivo activo, así que no hay nada sobre lo que
        predecir.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={runPrediction}
        disabled={isRunning}
        className="w-full rounded bg-ink px-3 py-2 text-sm font-medium text-canvas transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isRunning ? "Ejecutando el motor…" : "Guardar predicción"}
      </button>

      <p className="text-[11px] leading-snug text-muted">
        Ejecuta el motor en el servidor y guarda el resultado en el histórico. Las
        predicciones son inmutables: cada ejecución añade un registro nuevo.
      </p>

      {isRunning && <Spinner label="Consultando la API" />}
      {error && <ErrorState message={error} onRetry={runPrediction} />}

      {prediction && (
        <div
          data-testid="saved-prediction"
          className="space-y-3 rounded border border-line bg-surface-2 p-3"
        >
          <div className="flex items-center justify-between">
            <span className="eyebrow">
              Predicción guardada
            </span>
            <Tag>{prediction.model_version}</Tag>
          </div>

          <MetricGroup title="Resultado">
            <MetricRow
              label="Rendimiento proyectado"
              value={formatKg(prediction.projected_yield_kg)}
            />
            <MetricRow label="Toneladas" value={formatTons(prediction.projected_yield_tons)} />
            <MetricRow label="Cajas" value={formatInteger(prediction.projected_boxes)} />
            <MetricRow
              label="Pérdida estimada"
              value={formatPercent(prediction.estimated_loss_percentage)}
            />
            <MetricRow label="Risk score" value={formatScore(prediction.risk_score)} />
            <MetricRow label="Nivel de riesgo" value={<RiskBadge level={prediction.risk_level} />} />
          </MetricGroup>

          <MetricGroup title="Factores (1.00 = neutro)">
            {(Object.keys(FACTOR_LABELS) as (keyof Prediction["factors"])[]).map((key) => (
              <MetricRow
                key={key}
                label={FACTOR_LABELS[key]}
                value={
                  <span>
                    {formatScore(prediction.factors[key])}
                    <span className="ml-2 text-muted">
                      {formatFactorDelta(prediction.factors[key])}
                    </span>
                  </span>
                }
              />
            ))}
          </MetricGroup>

          <p className="tabular text-[10px] text-muted">
            Registrada el {formatDateTime(prediction.created_at)}
          </p>
        </div>
      )}
    </div>
  );
}
