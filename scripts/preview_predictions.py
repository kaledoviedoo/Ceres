"""Ejecuta el motor sobre el dataset sintetico y muestra tres celdas.

    py scripts/preview_predictions.py

Sin base de datos y sin API: construye el dataset en memoria, predice las 400
celdas de Plot A y ensena la mejor, la mediana y la peor. Sirve para inspeccionar
el comportamiento del motor de un vistazo despues de tocar una formula.

MODELO EXPERIMENTAL / DEMOSTRATIVO sobre DATOS SINTETICOS.
"""

from __future__ import annotations

import _bootstrap  # noqa: F401  (efecto lateral: ajusta sys.path)

from app.core.prediction import CropParameters, PredictionInput, predict_from_input
from app.core.synthetic.demo import build_demo_dataset


def build_input(cell: dict, crop: CropParameters) -> PredictionInput:
    return PredictionInput(
        cell_id=cell["id"],
        cell_code=cell["cell_code"],
        area_m2=1.0,
        elevation_m=cell["elevation_m"],
        slope_deg=cell["slope_deg"],
        soil_quality=cell["soil_quality"],
        plant_density=cell["plant_density"],
        health_factor=cell["health_factor"],
        base_yield_factor=cell["base_yield_factor"],
        crop=crop,
    )


def render(label: str, cell: dict, result) -> None:
    print(f"\n{'=' * 74}")
    print(f"  {label}  -  {result.cell_code}   (x={cell['x']}, y={cell['y']})")
    print("=" * 74)

    print("  ENTRADA")
    print(f"    elevacion          {cell['elevation_m']:>10.2f} msnm")
    print(f"    pendiente          {cell['slope_deg']:>10.2f} grados")
    print(f"    calidad de suelo   {cell['soil_quality']:>10.4f}")
    print(f"    densidad           {cell['plant_density']:>10.4f} plantas/m2")
    print(f"    sanidad            {cell['health_factor']:>10.4f}")
    print(f"    factor residual    {cell['base_yield_factor']:>10.4f}")

    print("  PREDICCION")
    print(f"    rendimiento        {result.projected_yield_kg:>10.4f} kg")
    print(f"    toneladas          {result.projected_yield_tons:>10.6f} t")
    print(f"    cajas              {result.projected_boxes:>10d}")
    print(f"    perdida estimada   {result.estimated_loss_percentage:>10.2f} %")
    print(f"    risk_score         {result.risk_score:>10.4f}")
    print(f"    risk_level         {result.risk_level.value:>10}")
    print(f"    model_version      {result.model_version:>10}")

    print("  FACTORES (1.00 = neutro)")
    for name, value in result.factors.as_dict().items():
        delta = (value - 1.0) * 100.0
        print(f"    {name:<18} {value:>10.4f}   ({delta:+6.1f}%)")


def main() -> int:
    dataset = build_demo_dataset()

    crop_row = dataset.table("crops").rows[0]
    crop = CropParameters(
        slug=crop_row["slug"],
        base_yield_kg_per_m2=crop_row["base_yield_kg_per_m2"],
        box_capacity_kg=crop_row["box_capacity_kg"],
        optimal_plant_density_per_m2=crop_row["optimal_plant_density_per_m2"],
    )

    plot_a_id = dataset.table("plots").rows[0]["id"]
    cells = [c for c in dataset.table("grid_cells").rows if c["plot_id"] == plot_a_id]

    paired = [(cell, predict_from_input(build_input(cell, crop))) for cell in cells]
    paired.sort(key=lambda pair: pair[1].projected_yield_kg)

    print(f"CERES - motor {paired[0][1].model_version} sobre {len(paired)} celdas de Plot A")
    print(f"Cultivo: {crop.slug}  |  base {crop.base_yield_kg_per_m2} kg/m2  "
          f"|  caja {crop.box_capacity_kg} kg  |  densidad optima {crop.optimal_plant_density_per_m2}/m2")

    render("CELDA FAVORABLE", *paired[-1])
    render("CELDA MEDIA", *paired[len(paired) // 2])
    render("CELDA DESFAVORABLE", *paired[0])

    yields = [result.projected_yield_kg for _, result in paired]
    risks = [result.risk_score for _, result in paired]
    levels = [result.risk_level.value for _, result in paired]

    print(f"\n{'=' * 74}")
    print("  RESUMEN DEL LOTE")
    print("=" * 74)
    print(f"    rendimiento  min {min(yields):.2f} kg | "
          f"medio {sum(yields) / len(yields):.2f} kg | max {max(yields):.2f} kg")
    print(f"    total lote   {sum(yields):.2f} kg  ({sum(yields) / 1000:.4f} t en 400 m2)")
    print(f"    risk_score   min {min(risks):.4f} | "
          f"medio {sum(risks) / len(risks):.4f} | max {max(risks):.4f}")
    for level in ("low", "medium", "high"):
        print(f"    riesgo {level:<7} {levels.count(level):>4} celdas")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
