"""Generacion del campo de caracteristicas de un lote.

Patrones espaciales que se construyen aqui (pedidos en el brief, seccion 7):

    norte  -> mayor elevacion          sur   -> menor elevacion
    este   -> mejor suelo              oeste -> mayor riesgo sanitario

Sobre esos gradientes se superpone ruido suave para que el mapa no parezca un
degradado de Photoshop, y la pendiente se DERIVA de la elevacion en lugar de
sortearse aparte: asi el terreno es internamente coherente (donde la superficie
sube rapido, la pendiente es alta).

Convencion de ejes: x = 0 es oeste, y = 0 es sur.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from app.core.synthetic.noise import smooth_noise

#: Metros por grado de latitud. Constante suficiente para una finca de 20 m.
METERS_PER_DEGREE_LATITUDE = 111_320.0


@dataclass(frozen=True, slots=True)
class TerrainProfile:
    """Parametros del terreno sintetico.

    Los valores por defecto describen una ladera andina suave en Colombia.
    """

    #: Altitud de la esquina sur del lote (msnm).
    base_elevation_m: float = 1180.0
    #: Cuanto sube el terreno del sur al norte, en metros.
    north_rise_m: float = 2.4
    #: Amplitud del ruido de elevacion, en metros.
    elevation_noise_m: float = 0.5

    #: Calidad de suelo en el borde oeste y ganancia hacia el este.
    soil_base: float = 0.42
    soil_east_gain: float = 0.34
    soil_noise: float = 0.10

    #: Foco de estres sanitario en el oeste: centro (nx, ny) y dispersion.
    stress_center_x: float = 0.18
    stress_center_y: float = 0.55
    stress_sigma: float = 0.30

    #: Sanidad en ausencia de estres, y cuanto le restan el foco y la pendiente.
    health_base: float = 0.92
    health_stress_penalty: float = 0.34
    health_slope_penalty: float = 0.18
    health_noise: float = 0.07

    #: Densidad de siembra objetivo (plantas/m2) y su dispersion relativa.
    target_plant_density: float = 2.5
    density_noise: float = 0.10
    #: Cuantas plantas/m2 se pierden en la pendiente maxima considerada.
    density_slope_penalty: float = 0.35

    #: Dispersion del multiplicador residual, centrado en 1.0.
    base_yield_noise: float = 0.06

    #: Pendiente (grados) a partir de la cual se considera penalizacion maxima.
    slope_reference_deg: float = 15.0


@dataclass(frozen=True, slots=True)
class CellFeatureGrid:
    """Caracteristicas de todas las celdas de un lote, como arrays `[y, x]`."""

    width: int
    height: int
    cell_size_m: float
    elevation_m: np.ndarray
    slope_deg: np.ndarray
    soil_quality: np.ndarray
    plant_density: np.ndarray
    health_factor: np.ndarray
    base_yield_factor: np.ndarray

    def cell_count(self) -> int:
        return self.width * self.height


def generate_cell_features(
    width: int,
    height: int,
    seed: int,
    cell_size_m: float = 1.0,
    profile: TerrainProfile | None = None,
) -> CellFeatureGrid:
    """Genera el campo completo de caracteristicas de un lote.

    Es una funcion pura: mismos argumentos -> mismos arrays, siempre.
    """
    if width < 2 or height < 2:
        raise ValueError("La malla debe ser de al menos 2x2 para derivar pendiente")
    if cell_size_m <= 0:
        raise ValueError("cell_size_m debe ser > 0")

    profile = profile or TerrainProfile()

    # Streams independientes por variable: anadir una variable nueva no cambia
    # los valores de las que ya existian.
    streams = np.random.SeedSequence(seed).spawn(5)
    noise_elev, noise_soil, noise_health, noise_density, noise_residual = (
        smooth_noise(np.random.default_rng(s), width, height, lattice=lat)
        for s, lat in zip(streams, (3, 3, 4, 5, 6), strict=True)
    )

    # Coordenadas normalizadas: nx = 0 oeste .. 1 este, ny = 0 sur .. 1 norte.
    nx = np.linspace(0.0, 1.0, width)[None, :] * np.ones((height, 1))
    ny = np.linspace(0.0, 1.0, height)[:, None] * np.ones((1, width))

    # --- Elevacion: gradiente sur->norte + ondulacion suave --------------------
    elevation = (
        profile.base_elevation_m
        + profile.north_rise_m * ny
        + profile.elevation_noise_m * noise_elev
    )

    # --- Pendiente: derivada del propio terreno, no sorteada -------------------
    grad_y, grad_x = np.gradient(elevation, cell_size_m, cell_size_m)
    slope = np.degrees(np.arctan(np.hypot(grad_x, grad_y)))
    slope = np.clip(slope, 0.0, 90.0)
    slope_norm = np.clip(slope / profile.slope_reference_deg, 0.0, 1.0)

    # --- Suelo: mejor hacia el este -------------------------------------------
    soil = profile.soil_base + profile.soil_east_gain * nx + profile.soil_noise * noise_soil
    soil = np.clip(soil, 0.05, 0.98)

    # --- Sanidad: foco de estres en el oeste + castigo por pendiente ----------
    stress = np.exp(
        -(
            (nx - profile.stress_center_x) ** 2
            + (ny - profile.stress_center_y) ** 2
        )
        / (2.0 * profile.stress_sigma**2)
    )
    health = (
        profile.health_base
        - profile.health_stress_penalty * stress
        - profile.health_slope_penalty * slope_norm
        + profile.health_noise * noise_health
    )
    health = np.clip(health, 0.05, 1.0)

    # --- Densidad de siembra: casi uniforme, peor en pendiente ----------------
    density = (
        profile.target_plant_density * (1.0 + profile.density_noise * noise_density)
        - profile.density_slope_penalty * slope_norm
    )
    density = np.clip(density, 0.2, profile.target_plant_density * 1.15)

    # --- Multiplicador residual: variacion local no explicada ------------------
    base_yield_factor = np.clip(1.0 + profile.base_yield_noise * noise_residual, 0.80, 1.20)

    return CellFeatureGrid(
        width=width,
        height=height,
        cell_size_m=cell_size_m,
        elevation_m=elevation,
        slope_deg=slope,
        soil_quality=soil,
        plant_density=density,
        health_factor=health,
        base_yield_factor=base_yield_factor,
    )


def cell_centroid(
    origin_latitude: float,
    origin_longitude: float,
    x: int,
    y: int,
    cell_size_m: float,
) -> tuple[float, float]:
    """Centroide geografico de la celda (x, y) respecto a la esquina suroeste.

    Aproximacion de placa plana: valida a escala de decenas de metros, que es
    todo lo que necesita el MVP. Se sustituira por PostGIS cuando haga falta.
    """
    latitude = origin_latitude + ((y + 0.5) * cell_size_m) / METERS_PER_DEGREE_LATITUDE
    meters_per_degree_lon = METERS_PER_DEGREE_LATITUDE * math.cos(math.radians(latitude))
    longitude = origin_longitude + ((x + 0.5) * cell_size_m) / meters_per_degree_lon
    return latitude, longitude


def build_cell_code(plot_code: str, x: int, y: int, width: int) -> str:
    """`cell_code` legible y estable: 'A-00001' para (x=0, y=0).

    El indice recorre la malla por filas de sur a norte, de oeste a este.
    """
    index = y * width + x + 1
    return f"{plot_code}-{index:05d}"
