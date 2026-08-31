/**
 * Datos de prueba con la forma exacta que devuelve la API.
 *
 * Los valores no son inventados: salen del dataset sintético real (celda
 * A-00240, la favorable identificada en la fase 3). Eso permite que un test
 * pueda afirmar que la interfaz muestra exactamente lo que dice el backend.
 */

import type {
  CellDetail,
  CellOverview,
  CropCycle,
  FarmDetail,
  HealthStatus,
  PlotOverview,
  Prediction,
  RiskLevel,
} from "@/lib/types/api";

export const FARM_ID = "dd080122-154a-5b99-9d00-034af1f0d6fb";
export const PLOT_A_ID = "492ecd2d-5288-5a6a-bdf1-fc2f46771208";
export const CYCLE_ID = "061a0981-eb72-5afe-976b-bb8fee631de8";
export const CELL_ID = "408d5c38-b190-5642-b0d6-be6a24da7c87";

export const health: HealthStatus = {
  status: "ok",
  version: "0.1.0",
  model_version: "rule-based-v0.1",
  database: "ok",
  disclaimer:
    "DEMO / SYNTHETIC DATA. El motor de prediccion es un modelo experimental y demostrativo.",
};

export const farmDetail: FarmDetail = {
  id: FARM_ID,
  organization_id: "f79e74ed-664e-5939-8f62-dc01cdaf8ca8",
  name: "CERES Demo Farm",
  country: "CO",
  region: "Boyaca (Villa de Leyva)",
  latitude: 5.6277878,
  longitude: -73.4881402,
  created_at: "2026-08-30T22:00:00Z",
  plots: [
    {
      id: PLOT_A_ID,
      farm_id: FARM_ID,
      name: "Plot A",
      code: "A",
      grid_width: 20,
      grid_height: 20,
      cell_size_m: 1,
      origin_latitude: 5.6277878,
      origin_longitude: -73.4881402,
      created_at: "2026-08-30T22:00:00Z",
      cell_count: 400,
      area_m2: 400,
    },
  ],
};

export const cropCycle: CropCycle = {
  id: CYCLE_ID,
  plot_id: PLOT_A_ID,
  crop_id: "ba3f9aaa-c748-502e-81ef-25ebf1778d95",
  name: "Tomate 2026-A",
  slug: "tomate-2026a",
  status: "active",
  planted_at: "2026-02-15",
  expected_harvest_at: "2026-06-15",
  created_at: "2026-08-30T22:00:00Z",
  crop: {
    id: "ba3f9aaa-c748-502e-81ef-25ebf1778d95",
    organization_id: "f79e74ed-664e-5939-8f62-dc01cdaf8ca8",
    name: "Tomate",
    slug: "tomato",
    variety: "Chonto",
    box_capacity_kg: 6,
    base_yield_kg_per_m2: 12,
    optimal_plant_density_per_m2: 2.5,
    cycle_days: 120,
    created_at: "2026-08-30T22:00:00Z",
  },
};

/** La celda favorable real: A-00240, x=19 y=11. */
export const cellDetail: CellDetail = {
  id: CELL_ID,
  cell_code: "A-00240",
  x: 19,
  y: 11,
  elevation_m: 1181.164,
  slope_deg: 2.03,
  soil_quality: 0.722,
  plant_density: 2.6511,
  health_factor: 0.929,
  base_yield_factor: 0.9872,
  plot_id: PLOT_A_ID,
  centroid_latitude: 5.6278911,
  centroid_longitude: -73.4879686,
  created_at: "2026-08-30T22:00:00Z",
};

export const cellOverview: CellOverview = {
  cell_id: CELL_ID,
  cell_code: "A-00240",
  x: 19,
  y: 11,
  projected_yield_kg: 11.9634,
  projected_boxes: 2,
  estimated_loss_percentage: 9.18,
  risk_score: 0.1492,
  risk_level: "low",
};

export const prediction: Prediction = {
  id: "64085863-d70a-4b7b-a8cc-ce4cecd416fb",
  cell_id: CELL_ID,
  crop_cycle_id: CYCLE_ID,
  model_version: "rule-based-v0.1",
  projected_yield_kg: 11.9634,
  projected_yield_tons: 0.0119634,
  projected_boxes: 2,
  estimated_loss_percentage: 9.18,
  risk_score: 0.1492,
  risk_level: "low",
  factors: {
    density_factor: 1.0604,
    soil_factor: 1.061,
    health_factor: 0.929,
    terrain_factor: 0.9662,
    base_yield_factor: 0.9872,
  },
  created_at: "2026-08-30T21:44:08Z",
};

/** Malla completa de 400 celdas con los tres niveles de riesgo presentes. */
export function buildOverview(): PlotOverview {
  const cells: CellOverview[] = [];
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < 20; x += 1) {
      // Foco crítico en el noroeste, igual que el dataset sintético real.
      const inFocus = x <= 5 && y >= 13 && y <= 16;
      const nearFocus = x <= 9 && y >= 11;
      const level: RiskLevel = inFocus ? "high" : nearFocus ? "medium" : "low";
      const index = y * 20 + x + 1;
      cells.push({
        cell_id: `cell-${x}-${y}`,
        cell_code: `A-${String(index).padStart(5, "0")}`,
        x,
        y,
        projected_yield_kg: level === "high" ? 1.5 : level === "medium" ? 6.5 : 11.5,
        projected_boxes: level === "high" ? 1 : 2,
        estimated_loss_percentage: level === "high" ? 40 : level === "medium" ? 20 : 5,
        risk_score: level === "high" ? 0.8 : level === "medium" ? 0.45 : 0.15,
        risk_level: level,
      });
    }
  }
  return {
    plot_id: PLOT_A_ID,
    crop_cycle_id: CYCLE_ID,
    grid_width: 20,
    grid_height: 20,
    cell_size_m: 1,
    model_version: "rule-based-v0.1",
    persisted: false,
    cells,
  };
}
