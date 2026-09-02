"""Integridad del dataset sintetico (fase 4.6).

Comprueba la forma del dataset, su reproducibilidad y que la zona critica
sintetica produce los tres niveles de riesgo sin haber tocado el modelo.
"""

from __future__ import annotations

from dataclasses import replace

import pytest

from app.core.prediction import CropParameters, PredictionInput, predict_from_input
from app.core.synthetic.demo import DEFAULT_SEED, build_demo_dataset
from app.core.synthetic.field import TerrainProfile
from app.domain.enums import RiskLevel


def crop_from(dataset) -> CropParameters:
    row = dataset.table("crops").rows[0]
    return CropParameters(
        slug=row["slug"],
        base_yield_kg_per_m2=row["base_yield_kg_per_m2"],
        box_capacity_kg=row["box_capacity_kg"],
        optimal_plant_density_per_m2=row["optimal_plant_density_per_m2"],
    )


def risk_map(dataset) -> dict[tuple[int, int], RiskLevel]:
    """Nivel de riesgo de cada celda de Plot A, indexado por (x, y)."""
    crop = crop_from(dataset)
    plot_a = dataset.table("plots").rows[0]["id"]

    result = {}
    for cell in dataset.table("grid_cells").rows:
        if cell["plot_id"] != plot_a:
            continue
        prediction = predict_from_input(
            PredictionInput(
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
        )
        result[(cell["x"], cell["y"])] = prediction.risk_level
    return result


@pytest.fixture(scope="module")
def dataset():
    return build_demo_dataset()


# --- Forma del dataset --------------------------------------------------------


def test_grid_is_four_hundred_cells_per_plot(dataset):
    # Un solo lote: el segundo existia sin ciclo de cultivo y en la interfaz era
    # una opcion que no mostraba nada. Los invariantes de coherencia entre lotes
    # siguen probados, con un lote que crean los propios tests.
    plots = dataset.table("plots").rows
    cells = dataset.table("grid_cells").rows

    assert len(plots) == 1
    for plot in plots:
        assert sum(1 for c in cells if c["plot_id"] == plot["id"]) == 400
    assert len(cells) == 400


def test_observation_count_is_stable(dataset):
    assert len(dataset.table("observations").rows) == 24


def test_dataset_contains_no_predictions_or_harvests(dataset):
    """El seed carga terreno y observaciones, nunca resultados.

    Las predicciones y cosechas las produce el sistema en ejecucion; si el seed
    las trajera, no se sabria distinguir lo generado de lo medido.
    """
    tables = {table.name for table in dataset.tables}

    assert "predictions" not in tables
    assert "harvests" not in tables


# --- Reproducibilidad ---------------------------------------------------------


def test_same_seed_produces_identical_cells(dataset):
    again = build_demo_dataset(seed=DEFAULT_SEED)

    assert dataset.table("grid_cells").rows == again.table("grid_cells").rows


def test_same_seed_produces_identical_observations(dataset):
    again = build_demo_dataset(seed=DEFAULT_SEED)

    assert dataset.table("observations").rows == again.table("observations").rows


def test_same_seed_renders_byte_identical_sql():
    """La reproducibilidad tiene que llegar hasta el archivo, no solo a la memoria."""
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "scripts"))
    from generate_demo_data import render_seed

    assert render_seed(build_demo_dataset()) == render_seed(build_demo_dataset())


def test_a_different_seed_produces_a_different_farm(dataset):
    other = build_demo_dataset(seed=DEFAULT_SEED + 1)

    assert dataset.table("grid_cells").rows != other.table("grid_cells").rows


# --- Zona critica sintetica ---------------------------------------------------


def test_dataset_produces_all_three_risk_levels(dataset):
    """Sin los tres niveles, la vista de riesgo del frontend no se puede probar."""
    levels = set(risk_map(dataset).values())

    assert levels == {RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH}


def test_high_risk_comes_from_the_critical_zone_not_from_the_model():
    """La prueba de que no se toco el modelo para conseguir HIGH.

    Con las penalizaciones de la zona critica a cero, y el resto del generador y
    del motor exactamente igual, no queda ninguna celda de riesgo alto.
    """
    sin_zona = TerrainProfile(
        critical_health_penalty=0.0,
        critical_soil_penalty=0.0,
        critical_elevation_drop_m=0.0,
    )
    levels = set(risk_map(build_demo_dataset(profile=sin_zona)).values())

    assert RiskLevel.HIGH not in levels
    assert RiskLevel.MEDIUM in levels
    assert RiskLevel.LOW in levels


def test_critical_zone_is_a_single_contiguous_focus(dataset):
    """Coherencia espacial: un foco, no celdas malas salpicadas por el mapa."""
    highs = {xy for xy, level in risk_map(dataset).items() if level is RiskLevel.HIGH}
    assert highs, "no hay celdas de riesgo alto"

    seen: set[tuple[int, int]] = set()
    components = 0
    for start in highs:
        if start in seen:
            continue
        components += 1
        stack = [start]
        while stack:
            x, y = stack.pop()
            if (x, y) in seen:
                continue
            seen.add((x, y))
            stack.extend(
                (x + dx, y + dy)
                for dx in (-1, 0, 1)
                for dy in (-1, 0, 1)
                if (x + dx, y + dy) in highs
            )

    assert components == 1


def test_critical_zone_sits_in_the_northwest(dataset):
    """Donde la coloca el perfil: dentro del area de estres del oeste."""
    highs = [xy for xy, level in risk_map(dataset).items() if level is RiskLevel.HIGH]

    mean_x = sum(x for x, _ in highs) / len(highs)
    mean_y = sum(y for _, y in highs) / len(highs)

    assert mean_x < 10, "el foco deberia estar en la mitad oeste"
    assert mean_y > 10, "el foco deberia estar en la mitad norte"


def test_risk_decays_outward_from_the_focus(dataset):
    """Transicion continua: el anillo alrededor del foco es medium, no low."""
    levels = risk_map(dataset)
    highs = [xy for xy, level in levels.items() if level is RiskLevel.HIGH]

    border = {
        (x + dx, y + dy)
        for x, y in highs
        for dx in (-1, 0, 1)
        for dy in (-1, 0, 1)
        if (x + dx, y + dy) in levels and levels[(x + dx, y + dy)] is not RiskLevel.HIGH
    }

    assert border, "el foco no puede ocupar el lote entero"
    assert all(levels[xy] is RiskLevel.MEDIUM for xy in border)


def test_critical_zone_keeps_features_within_domain_ranges(dataset):
    """Hundir sanidad y suelo no puede sacar ningun valor de su rango."""
    for cell in dataset.table("grid_cells").rows:
        assert 0.0 <= cell["soil_quality"] <= 1.0
        assert 0.0 <= cell["health_factor"] <= 1.0
        assert 0.0 <= cell["slope_deg"] <= 90.0
        assert cell["plant_density"] >= 0.0
        assert cell["base_yield_factor"] > 0.0


def test_critical_zone_is_also_visible_in_the_terrain(dataset):
    """La hondonada tiene que existir en el relieve, no solo en el color.

    Importa para la fase 7: el terreno 3D se deforma con la elevacion, y una
    zona critica plana se veria como una mancha pintada encima.
    """
    plot_a = dataset.table("plots").rows[0]["id"]
    cells = [c for c in dataset.table("grid_cells").rows if c["plot_id"] == plot_a]

    focus = [c for c in cells if 1 <= c["x"] <= 4 and 13 <= c["y"] <= 16]
    same_latitude = [c for c in cells if c["x"] >= 14 and 13 <= c["y"] <= 16]

    focus_elevation = sum(c["elevation_m"] for c in focus) / len(focus)
    reference_elevation = sum(c["elevation_m"] for c in same_latitude) / len(same_latitude)

    assert focus_elevation < reference_elevation


def test_disabling_the_zone_leaves_the_rest_of_the_terrain_untouched():
    """La zona critica solo afecta a su entorno: el este queda igual."""
    con_zona = build_demo_dataset()
    sin_zona = build_demo_dataset(
        profile=replace(
            TerrainProfile(),
            critical_health_penalty=0.0,
            critical_soil_penalty=0.0,
            critical_elevation_drop_m=0.0,
        )
    )

    def eastern(dataset):
        plot_a = dataset.table("plots").rows[0]["id"]
        return {
            c["cell_code"]: (c["soil_quality"], c["health_factor"])
            for c in dataset.table("grid_cells").rows
            if c["plot_id"] == plot_a and c["x"] >= 15
        }

    assert eastern(con_zona) == eastern(sin_zona)
