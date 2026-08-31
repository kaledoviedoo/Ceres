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

import { useState } from "react";

import { MetricGroup, MetricRow } from "@/components/cell-inspector/MetricRow";
import { RiskBadge, Tag } from "@/components/ui/Badge";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";
import { ceresApi } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/errors";
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
}

export function PredictionPanel({ cellId, cropCycleId }: PredictionPanelProps) {
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runPrediction() {
    if (!cropCycleId) return;
    setIsRunning(true);
    setError(null);
    try {
      setPrediction(await ceresApi.createPrediction({ cell_id: cellId, crop_cycle_id: cropCycleId }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : "Error inesperado");
    } finally {
      setIsRunning(false);
    }
  }

  if (!cropCycleId) {
    return (
      <p className="text-xs text-ceres-dim">
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
        className="w-full rounded bg-ceres-accent px-3 py-2 text-sm font-semibold text-ceres-bg transition-colors hover:bg-ceres-accent-dim disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isRunning ? "Ejecutando el motor…" : "Guardar predicción"}
      </button>

      <p className="text-[11px] leading-snug text-ceres-dim">
        Ejecuta el motor en el servidor y guarda el resultado en el histórico. Las
        predicciones son inmutables: cada ejecución añade un registro nuevo.
      </p>

      {isRunning && <Spinner label="Consultando la API" />}
      {error && <ErrorState message={error} onRetry={runPrediction} />}

      {prediction && (
        <div
          data-testid="saved-prediction"
          className="space-y-3 rounded border border-ceres-border bg-ceres-elevated p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-ceres-dim">
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
                    <span className="ml-2 text-ceres-muted">
                      {formatFactorDelta(prediction.factors[key])}
                    </span>
                  </span>
                }
              />
            ))}
          </MetricGroup>

          <p className="tabular text-[10px] text-ceres-dim">
            Registrada el {formatDateTime(prediction.created_at)}
          </p>
        </div>
      )}
    </div>
  );
}
