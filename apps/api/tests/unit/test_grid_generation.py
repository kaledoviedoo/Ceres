"""Tests del generador de terreno sintetico (fase 2).

Lo que se verifica aqui es lo que el brief exige del dataset: que sea
determinista, que respete los rangos del dominio y que tenga estructura
espacial real en vez de ruido blanco.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.core.synthetic.demo import DEFAULT_SEED, build_demo_dataset, demo_uuid
from app.core.synthetic.field import (
    build_cell_code,
    cell_centroid,
    generate_cell_features,
)

WIDTH = 20
HEIGHT = 20


@pytest.fixture(scope="module")
def features():
    return generate_cell_features(width=WIDTH, height=HEIGHT, seed=DEFAULT_SEED)


# --- Determinismo -------------------------------------------------------------


def test_same_seed_produces_identical_field():
    a = generate_cell_features(width=WIDTH, height=HEIGHT, seed=DEFAULT_SEED)
    b = generate_cell_features(width=WIDTH, height=HEIGHT, seed=DEFAULT_SEED)

    for name in ("elevation_m", "slope_deg", "soil_quality", "plant_density", "health_factor"):
        np.testing.assert_array_equal(getattr(a, name), getattr(b, name))


def test_different_seed_produces_different_field():
    a = generate_cell_features(width=WIDTH, height=HEIGHT, seed=DEFAULT_SEED)
    b = generate_cell_features(width=WIDTH, height=HEIGHT, seed=DEFAULT_SEED + 1)

    assert not np.array_equal(a.soil_quality, b.soil_quality)


# --- Rangos del dominio -------------------------------------------------------


def test_features_respect_domain_ranges(features):
    assert features.soil_quality.min() >= 0.0
    assert features.soil_quality.max() <= 1.0
    assert features.health_factor.min() >= 0.0
    assert features.health_factor.max() <= 1.0
    assert features.slope_deg.min() >= 0.0
    assert features.slope_deg.max() <= 90.0
    assert features.plant_density.min() >= 0.0
    assert features.base_yield_factor.min() > 0.0


def test_grid_has_expected_shape(features):
    assert features.cell_count() == WIDTH * HEIGHT
    assert features.elevation_m.shape == (HEIGHT, WIDTH)


def test_rejects_degenerate_grid():
    with pytest.raises(ValueError):
        generate_cell_features(width=1, height=1, seed=DEFAULT_SEED)


# --- Estructura espacial ------------------------------------------------------


def test_north_is_higher_than_south(features):
    south_band = features.elevation_m[: HEIGHT // 4, :].mean()
    north_band = features.elevation_m[-HEIGHT // 4 :, :].mean()
    assert north_band > south_band


def test_east_has_better_soil_than_west(features):
    west_band = features.soil_quality[:, : WIDTH // 4].mean()
    east_band = features.soil_quality[:, -WIDTH // 4 :].mean()
    assert east_band > west_band


def test_west_is_less_healthy_than_east(features):
    west_band = features.health_factor[:, : WIDTH // 4].mean()
    east_band = features.health_factor[:, -WIDTH // 4 :].mean()
    assert west_band < east_band


def test_field_is_not_white_noise(features):
    """Celdas vecinas deben parecerse mas entre si que celdas lejanas."""
    neighbour_diff = np.abs(np.diff(features.soil_quality, axis=1)).mean()
    shuffled = features.soil_quality.flatten().copy()
    np.random.default_rng(0).shuffle(shuffled)
    random_diff = np.abs(np.diff(shuffled)).mean()

    assert neighbour_diff < random_diff / 2


# --- Identidad y geografia de las celdas --------------------------------------


def test_cell_code_format():
    assert build_cell_code("A", x=0, y=0, width=20) == "A-00001"
    assert build_cell_code("A", x=19, y=0, width=20) == "A-00020"
    assert build_cell_code("A", x=0, y=1, width=20) == "A-00021"
    assert build_cell_code("B", x=19, y=19, width=20) == "B-00400"


def test_centroid_moves_north_and_east():
    origin_lat, origin_lon = 5.0, -73.0
    south_west = cell_centroid(origin_lat, origin_lon, x=0, y=0, cell_size_m=1.0)
    north_east = cell_centroid(origin_lat, origin_lon, x=19, y=19, cell_size_m=1.0)

    assert north_east[0] > south_west[0]  # mas al norte
    assert north_east[1] > south_west[1]  # mas al este


# --- Dataset de demo completo -------------------------------------------------


def test_demo_dataset_matches_brief_contents():
    dataset = build_demo_dataset()
    summary = dataset.summary()

    assert summary["organizations"] == 1
    assert summary["farms"] == 1
    assert summary["plots"] == 2
    assert summary["crops"] == 1
    assert summary["crop_cycles"] == 1
    assert summary["grid_cells"] == 800  # 400 por lote
    assert summary["observations"] > 0


def test_demo_dataset_ids_are_unique_and_stable():
    first = build_demo_dataset()
    second = build_demo_dataset()

    first_ids = [cell["id"] for cell in first.table("grid_cells").rows]
    second_ids = [cell["id"] for cell in second.table("grid_cells").rows]

    assert len(set(first_ids)) == len(first_ids)
    assert first_ids == second_ids


def test_demo_uuid_is_deterministic():
    assert demo_uuid("plot", "A") == demo_uuid("plot", "A")
    assert demo_uuid("plot", "A") != demo_uuid("plot", "B")


def test_demo_cells_are_unique_per_plot():
    dataset = build_demo_dataset()
    cells = dataset.table("grid_cells").rows

    coordinates = {(cell["plot_id"], cell["x"], cell["y"]) for cell in cells}
    codes = {(cell["plot_id"], cell["cell_code"]) for cell in cells}

    assert len(coordinates) == len(cells)
    assert len(codes) == len(cells)


def test_demo_observations_reference_existing_cells():
    dataset = build_demo_dataset()
    cell_ids = {cell["id"] for cell in dataset.table("grid_cells").rows}

    for observation in dataset.table("observations").rows:
        assert observation["cell_id"] in cell_ids
        assert 0.0 <= observation["severity"] <= 1.0


def test_demo_farm_is_located_in_colombia():
    farm = build_demo_dataset().table("farms").rows[0]

    assert farm["country"] == "CO"
    assert -4.5 < farm["latitude"] < 13.0
    assert -82.0 < farm["longitude"] < -66.0
