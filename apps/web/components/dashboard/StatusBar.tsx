"use client";

/**
 * Barra superior: identidad, estado del backend y el aviso de datos sintéticos.
 *
 * El disclaimer no está escrito aquí: lo devuelve `GET /api/v1/health`. Si
 * alguna vez cambia la política sobre cómo se describe el modelo, cambia en un
 * sitio y esta barra se entera sola.
 */

import { Tag } from "@/components/ui/Badge";
import type { HealthStatus } from "@/lib/types/api";

export function StatusBar({ health, error }: { health: HealthStatus | null; error: string | null }) {
  const online = Boolean(health) && !error;

  return (
    <header className="border-b border-ceres-border bg-ceres-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-base font-semibold tracking-tight text-ceres-accent">CERES</span>
          <span className="text-xs text-ceres-muted">Digital Twin agrícola</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {health && <Tag>modelo {health.model_version}</Tag>}
          {health && <Tag>API v{health.version}</Tag>}
          <span className="flex items-center gap-1.5 text-xs text-ceres-muted">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: online ? "#22c55e" : "#ef4444" }}
            />
            {online ? `Backend conectado · BD ${health?.database}` : "Backend no disponible"}
          </span>
        </div>
      </div>

      <p className="border-t border-ceres-border/60 bg-ceres-bg px-6 py-1.5 text-[11px] text-ceres-dim">
        {health?.disclaimer ??
          "DEMO / SYNTHETIC DATA. Modelo experimental y demostrativo sobre datos sintéticos."}
      </p>
    </header>
  );
}
