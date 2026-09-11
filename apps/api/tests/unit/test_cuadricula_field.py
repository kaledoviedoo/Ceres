"""EL CAMPO DE LA CUADRICULA: forma, continuidad y estructura espacial.

Lo que estos tests vigilan es que el dataset siga siendo una SIMULACION y no
cuatro sorteos: que la superficie sea una sola, que las variables varien de
verdad, que esa variacion tenga estructura espacial, y que las ocho celdas de
referencia sigan saliendo del campo en vez de estar escritas encima.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.core.synthetic.cuadricula import (
    CELL_SIZE_M,
    FARM_LATITUDE,
    FARM_LONGITUDE,
    FARM_SPAN,
    MASTER_SEED,
    PLOT_CELLS,
    PLOT_ORDER,
    REFERENCE_CELLS,
    SCENARIO,
    build_all_fields,
    build_cell_code,
    build_farm_surface,
    cell_centroid,
    cell_index_to_local,
    local_to_farm,
    plot_origin_latlon,
)

#: Umbral de autocorrelacion espacial. ES UN CRITERIO DE SANIDAD DEL DATASET,
#: NO UNA VERDAD AGRONOMICA. No dice que toda finca real tenga que dar 0,5; dice
#: que si nuestro generador baja de ahi es que dejo de producir patrones y
#: empezo a producir ruido, que es lo que se pidio evitar. Moran's I vale 0 en
#: ruido blanco y tiende a 1 en un campo perfectamente liso.
MORAN_SANITY_FLOOR = 0.5

VARIABLES = (
    "elevation_m",
    "slope_deg",
    "soil_quality",
    "plant_density",
    "health_factor",
    "base_yield_factor",
    "humidity",
)


@pytest.fixture(scope="module")
def campos():
    return build_all_fields()


@pytest.fixture(scope="module")
def superficie():
    return build_farm_surface()


def morans_i(field: np.ndarray) -> float:
    """Autocorrelacion espacial con vecindad de torre (arriba/abajo/izq/der).

    Se calcula con desplazamientos en vez de construir la matriz de pesos: para
    10.000 celdas esa matriz seria de 10^8 elementos.
    """
    z = field - field.mean()
    denominador = float((z**2).sum())
    if denominador == 0:
        return 0.0
    cruzados = float((z[:, :-1] * z[:, 1:]).sum() + (z[:-1, :] * z[1:, :]).sum())
    pares = z.shape[0] * (z.shape[1] - 1) + (z.shape[0] - 1) * z.shape[1]
    return (z.size / (2.0 * pares)) * (2.0 * cruzados) / denominador


# --- Forma -------------------------------------------------------------------


def test_there_are_exactly_four_plots():
    assert len(SCENARIO) == 4
    assert len(PLOT_ORDER) == 4


def test_each_plot_has_exactly_ten_thousand_cells(campos):
    for code in PLOT_ORDER:
        assert campos[code].elevation_m.shape == (PLOT_CELLS, PLOT_CELLS)
        assert campos[code].elevation_m.size == 10_000


def test_the_farm_has_exactly_forty_thousand_cells(campos):
    assert sum(c.elevation_m.size for c in campos.values()) == 40_000


def test_the_resolution_is_one_square_metre():
    assert CELL_SIZE_M == 1.0
    assert PLOT_CELLS * PLOT_CELLS * CELL_SIZE_M**2 == 10_000.0  # 1 ha por lote


def test_the_cell_code_covers_the_whole_plot_without_collisions():
    codigos = {build_cell_code("P", x, y) for y in range(PLOT_CELLS) for x in range(PLOT_CELLS)}
    assert len(codigos) == 10_000
    assert build_cell_code("P", 0, 0) == "P-00001"
    assert build_cell_code("P", 99, 99) == "P-10000"


def test_the_plot_prefixes_do_not_collide_with_the_demo_farm():
    """`tests/postgres/conftest.py` busca 'A-00240' sin filtrar por lote.

    Reutilizar el prefijo `A` devolveria dos filas y romperia la paridad de la
    finca demo. Por eso P/M/Z/R no es cosmetico.
    """
    assert "A" not in PLOT_ORDER


# --- Coordenadas -------------------------------------------------------------


def test_every_centroid_lands_inside_the_farm(campos):
    for code in PLOT_ORDER:
        for x, y in ((0, 0), (99, 99), (50, 50)):
            lat, lon = cell_centroid(code, x, y)
            assert -90 <= lat <= 90 and -180 <= lon <= 180
            # Media diagonal de la finca en grados, con margen.
            assert abs(lat - FARM_LATITUDE) < 0.0025
            assert abs(lon - FARM_LONGITUDE) < 0.0025


def test_the_farm_is_centred_on_the_declared_point():
    """Los cuatro origenes rodean el punto declarado, no lo repiten."""
    latitudes = [plot_origin_latlon(c)[0] for c in PLOT_ORDER]
    longitudes = [plot_origin_latlon(c)[1] for c in PLOT_ORDER]
    assert min(latitudes) < FARM_LATITUDE < max(latitudes) + 0.001
    assert min(longitudes) < FARM_LONGITUDE < max(longitudes) + 0.001


def test_the_axes_point_north_and_east():
    """y crece al norte, x al este. Lo asume `cell_centroid` y todo el frontend."""
    sur, oeste = cell_centroid("P", 0, 0)
    norte, _ = cell_centroid("P", 0, 99)
    _, este = cell_centroid("P", 99, 0)
    assert norte > sur
    assert este > oeste


# --- Topografia --------------------------------------------------------------


def test_the_four_plots_are_cut_from_one_surface(superficie, campos):
    """Continuidad: cada lote es un recorte, no un terreno propio."""
    for code in PLOT_ORDER:
        filas, columnas = superficie.plot_slice(code)
        assert np.array_equal(campos[code].elevation_m, superficie.elevation_m[filas, columnas])


def test_the_surface_has_no_seams_between_plots(superficie):
    """Un salto en la calle delataria cuatro superficies pegadas.

    Se compara el borde este de un lote con el borde oeste de su vecino, 21 m
    al este: la diferencia tiene que ser la del gradiente regional, no un
    escalon. Con cuatro terrenos independientes esta diferencia seria del orden
    del rango completo de cotas.
    """
    e = superficie.elevation_m
    frontera_oeste = e[:, PLOT_CELLS - 1]
    frontera_este = e[:, PLOT_CELLS + 20]
    salto = np.abs(frontera_este - frontera_oeste)
    rango_total = float(e.max() - e.min())
    assert salto.max() < 0.25 * rango_total


def test_the_slopes_are_cultivable(superficie):
    """Pendientes agricolas, no un acantilado."""
    pendiente_pct = np.tan(np.radians(superficie.slope_deg)) * 100
    assert pendiente_pct.max() < 20.0
    assert pendiente_pct.mean() < 8.0


def test_the_slope_is_derived_from_the_elevation_not_drawn(superficie):
    """Recalcular el gradiente tiene que devolver exactamente lo mismo."""
    gy, gx = np.gradient(superficie.elevation_m, CELL_SIZE_M, CELL_SIZE_M)
    esperado = np.degrees(np.arctan(np.hypot(gx, gy)))
    assert np.allclose(superficie.slope_deg, esperado)


def test_the_elevation_stays_in_the_declared_band(superficie):
    """El escenario declara cotas entre 2100 y 2112 m."""
    assert 2090.0 < superficie.elevation_m.min()
    assert superficie.elevation_m.max() < 2125.0


# --- Variabilidad y estructura espacial --------------------------------------


@pytest.mark.parametrize("variable", VARIABLES)
def test_every_variable_actually_varies(campos, variable: str):
    """Ninguna constante disfrazada de campo."""
    for code in PLOT_ORDER:
        valores = getattr(campos[code], variable)
        assert valores.std() > 0.0, f"{code}.{variable} es constante"
        assert len(np.unique(np.round(valores, 4))) > 100


@pytest.mark.parametrize("variable", VARIABLES)
def test_every_variable_has_spatial_structure(campos, variable: str):
    """CRITERIO DE SANIDAD DEL DATASET, no una afirmacion sobre fincas reales.

    Lo unico que se comprueba es que el generador siga produciendo patrones: si
    alguien sustituyera `smooth_noise` por `rng.normal`, Moran's I caeria a
    ~0 y este test se caeria. No dice que 0,5 sea el valor correcto de ninguna
    finca del mundo.
    """
    for code in PLOT_ORDER:
        i = morans_i(getattr(campos[code], variable))
        assert i > MORAN_SANITY_FLOOR, f"{code}.{variable}: Moran's I = {i:.3f}"


def test_white_noise_would_fail_the_sanity_criterion():
    """Que el criterio sirva para algo: el ruido blanco no lo pasa.

    Sin esto, el umbral podria estar tan bajo que lo aprobara todo.
    """
    blanco = np.random.default_rng(0).normal(size=(PLOT_CELLS, PLOT_CELLS))
    assert morans_i(blanco) < 0.1


def test_neighbouring_cells_are_not_identical_either(campos):
    """Variacion natural DENTRO del lote: continuo no es uniforme."""
    for code in PLOT_ORDER:
        salud = campos[code].health_factor
        diferencias = np.abs(np.diff(salud, axis=1))
        assert diferencias.mean() > 0.0
        assert (diferencias > 1e-6).mean() > 0.95


# --- La cadena de dependencias -----------------------------------------------


def test_humidity_follows_the_terrain_and_not_a_dice_roll(campos):
    """La humedad tiene que correlacionar con la depresion local.

    Es la primera union de la cadena; si se rompe, todo lo que cuelga de la
    humedad --suelo, sanidad, zonas de evento-- deja de tener causa.
    """
    for code in PLOT_ORDER:
        campo = campos[code]
        r = np.corrcoef(campo.depression_m.ravel(), campo.humidity.ravel())[0, 1]
        assert r > 0.5, f"{code}: correlacion humedad/depresion = {r:.3f}"


def test_health_peaks_near_the_crop_ideal_humidity(campos):
    """La respuesta es una campana, no una recta.

    Las celdas mas cercanas al optimo de humedad del cultivo tienen que estar
    mas sanas que las mas alejadas, EN LOS DOS SENTIDOS: si fuera lineal, un
    lote encharcado saldria sanisimo.
    """
    for crop in SCENARIO:
        campo = campos[crop.code]
        desvio = np.abs(campo.humidity - crop.ideal_humidity)
        cerca = campo.health_factor[desvio <= np.quantile(desvio, 0.25)]
        lejos = campo.health_factor[desvio >= np.quantile(desvio, 0.75)]
        assert cerca.mean() > lejos.mean(), crop.code


def test_density_drops_on_slopes(campos):
    for code in PLOT_ORDER:
        campo = campos[code]
        llano = campo.plant_density[campo.slope_deg <= np.quantile(campo.slope_deg, 0.25)]
        empinado = campo.plant_density[campo.slope_deg >= np.quantile(campo.slope_deg, 0.75)]
        assert llano.mean() > empinado.mean(), code


def test_soil_is_worse_where_the_slope_washes_it(campos):
    for code in PLOT_ORDER:
        campo = campos[code]
        r = np.corrcoef(campo.slope_deg.ravel(), campo.soil_quality.ravel())[0, 1]
        assert r < 0.0, f"{code}: el suelo mejora con la pendiente ({r:.3f})"


# --- Rangos utilizables ------------------------------------------------------


def test_every_variable_lands_in_the_range_the_schema_accepts(campos):
    """Los CHECK de `grid_cells` no pueden rechazar una sola celda."""
    for crop in SCENARIO:
        campo = campos[crop.code]
        assert (campo.slope_deg >= 0).all() and (campo.slope_deg <= 90).all()
        assert (campo.soil_quality > 0).all() and (campo.soil_quality <= 1).all()
        assert (campo.health_factor > 0).all() and (campo.health_factor <= 1).all()
        assert (campo.plant_density > 0).all()
        assert (campo.base_yield_factor > 0).all()
        assert (campo.humidity > 0).all() and (campo.humidity < 1).all()


# --- Las ocho celdas de referencia -------------------------------------------


def test_the_eight_reference_cells_exist_in_the_grid():
    for ref in REFERENCE_CELLS:
        x, y = cell_index_to_local(ref.index)
        assert 0 <= x < PLOT_CELLS and 0 <= y < PLOT_CELLS
        assert build_cell_code(ref.plot_code, x, y) == f"{ref.plot_code}-{ref.index:05d}"


def test_the_declared_elevations_come_out_of_the_field(campos):
    """LA PRUEBA DE QUE LOS ANCLAJES NO SE ESCRIBIERON ENCIMA.

    La superficie se construye para pasar por las siete cotas declaradas, asi
    que la desviacion es la que dejan el ruido y la hondonada anadidos despues.
    Medio metro sobre un rango de 17 m.
    """
    for ref in REFERENCE_CELLS:
        if ref.elevation_m is None:
            continue
        x, y = cell_index_to_local(ref.index)
        generada = float(campos[ref.plot_code].elevation_m[y, x])
        assert abs(generada - ref.elevation_m) < 0.6, f"{ref.plot_code}-{ref.index:05d}"


def test_the_healthy_reference_cells_pin_the_humidity_baseline(campos):
    """Las cuatro celdas SANAS salen practicamente exactas, y no por casualidad.

    De ellas se despeja la base hidrica de su lote, asi que la unica diferencia
    que queda es el ruido espacial que se suma despues.
    """
    for ref in REFERENCE_CELLS:
        if ref.condition != "sano":
            continue
        x, y = cell_index_to_local(ref.index)
        generada = float(campos[ref.plot_code].humidity[y, x])
        assert abs(generada - ref.humidity) < 0.04, f"{ref.plot_code}-{ref.index:05d}"


def test_the_affected_cells_are_off_in_the_direction_their_event_explains(campos):
    """Y las cuatro AFECTADAS no tienen por que cuadrar, por una razon de modelo.

    La humedad que declara una celda afectada describe su estado DURANTE su
    evento, no el del terreno. R-09500 llega con 0,90 y la etiqueta "ahogada":
    es una lectura de la inundacion del 2 de julio, no la humedad de fondo del
    lote. Forzar la base a ese 0,90 exigiria excavar un crater de varios metros
    para que la topografia sola lo explicara.

    Lo que si se exige es que el terreno las coloque del lado correcto: la de la
    gota, mas humeda que la sana de su lote; la del estres hidrico, mas seca.
    """
    generada = {}
    for ref in REFERENCE_CELLS:
        x, y = cell_index_to_local(ref.index)
        generada[(ref.plot_code, ref.index)] = float(campos[ref.plot_code].humidity[y, x])

    # (lote, sana, afectada, la afectada deberia salir mas humeda)
    for code, sana, afectada, mas_humeda in (
        ("P", 1, 8550, True),      # gota: fondo de vaguada
        ("M", 500, 4500, False),   # estres hidrico: loma seca
        ("R", 1000, 9500, True),   # ahogada: hondonada cerrada
    ):
        delta = generada[(code, afectada)] - generada[(code, sana)]
        assert (delta > 0) is mas_humeda, f"{code}: delta {delta:+.3f}"


def test_the_wet_reference_cell_is_wetter_than_the_dry_one_in_every_plot(campos):
    """Lo que de verdad importa de los anclajes: el ORDEN.

    Las magnitudes admiten compromiso; que el punto declarado humedo salga seco
    significaria que el campo no representa el escenario.
    """
    parejas = [("P", 1, 8550), ("M", 4500, 500), ("R", 1000, 9500)]
    for code, seco, humedo in parejas:
        campo = campos[code]
        xs, ys = cell_index_to_local(seco)
        xh, yh = cell_index_to_local(humedo)
        assert campo.humidity[yh, xh] > campo.humidity[ys, xs], code


def test_the_incomplete_reference_cell_is_left_incomplete():
    """R-09500 llega sin cota, sin densidad y sin rendimiento. Se queda asi."""
    r9500 = next(r for r in REFERENCE_CELLS if r.plot_code == "R" and r.index == 9500)
    assert r9500.elevation_m is None
    assert r9500.density_per_m2 is None
    assert r9500.yield_kg is None
    assert r9500.humidity == 0.90


# --- Reproducibilidad --------------------------------------------------------


def test_the_same_seed_gives_the_same_field_bit_for_bit():
    uno = build_all_fields(MASTER_SEED)
    otro = build_all_fields(MASTER_SEED)
    for code in PLOT_ORDER:
        for variable in VARIABLES:
            assert np.array_equal(getattr(uno[code], variable), getattr(otro[code], variable))


def test_a_different_seed_gives_a_different_field():
    """Si la semilla no cambiara nada, no seria una semilla."""
    uno = build_all_fields(MASTER_SEED)
    otro = build_all_fields(MASTER_SEED + 1)
    assert not np.array_equal(uno["P"].health_factor, otro["P"].health_factor)


def test_the_declared_anchors_survive_a_seed_change():
    """La topografia la mandan las cotas declaradas, no el ruido.

    Con otra semilla las cotas de los anclajes siguen saliendo: solo cambia el
    ruido que se suma encima.
    """
    otro = build_all_fields(MASTER_SEED + 7)
    for ref in REFERENCE_CELLS:
        if ref.elevation_m is None:
            continue
        x, y = cell_index_to_local(ref.index)
        assert abs(float(otro[ref.plot_code].elevation_m[y, x]) - ref.elevation_m) < 0.8


def test_the_farm_grid_is_big_enough_for_four_plots_and_the_alley():
    assert FARM_SPAN == 220
    for code in PLOT_ORDER:
        x, y = local_to_farm(code, PLOT_CELLS - 1, PLOT_CELLS - 1)
        assert x < FARM_SPAN and y < FARM_SPAN
