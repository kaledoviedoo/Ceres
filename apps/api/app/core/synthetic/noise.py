"""Ruido espacial suave y determinista.

El brief pide explicitamente que las caracteristicas de las celdas NO sean
ruido blanco: tienen que formar patrones visibles en el mapa. Un `rng.normal()`
por celda daria una imagen de television sin senal.

La tecnica es "value noise": se sortean valores en una malla gruesa y se
interpolan a la resolucion final con suavizado. El resultado es continuo entre
celdas vecinas, que es como se comporta el suelo real.
"""

from __future__ import annotations

import numpy as np


def _smoothstep(t: np.ndarray) -> np.ndarray:
    """Curva 3t^2 - 2t^3: derivada nula en los extremos.

    Evita los pliegues visibles que deja la interpolacion lineal pura en los
    bordes de la malla gruesa.
    """
    return t * t * (3.0 - 2.0 * t)


def smooth_noise(
    rng: np.random.Generator,
    width: int,
    height: int,
    lattice: int = 4,
) -> np.ndarray:
    """Campo de ruido suave de forma `(height, width)` con valores en [-1, 1].

    Args:
        rng: generador ya sembrado. Determina completamente el resultado.
        width: numero de celdas en el eje x (oeste -> este).
        height: numero de celdas en el eje y (sur -> norte).
        lattice: resolucion de la malla gruesa. Valores bajos producen
            manchas grandes; valores altos, textura mas fina.

    Returns:
        Array `(height, width)` indexado como `[y, x]`.
    """
    if width <= 0 or height <= 0:
        raise ValueError("width y height deben ser positivos")
    if lattice < 1:
        raise ValueError("lattice debe ser >= 1")

    # Malla gruesa con un nodo extra en cada eje para poder interpolar hasta el borde.
    coarse = rng.uniform(-1.0, 1.0, size=(lattice + 1, lattice + 1))

    # Posicion de cada celda fina dentro de la malla gruesa.
    ys = np.linspace(0.0, lattice, height) if height > 1 else np.zeros(1)
    xs = np.linspace(0.0, lattice, width) if width > 1 else np.zeros(1)

    y0 = np.clip(np.floor(ys).astype(int), 0, lattice - 1)
    x0 = np.clip(np.floor(xs).astype(int), 0, lattice - 1)
    ty = _smoothstep(ys - y0)[:, None]
    tx = _smoothstep(xs - x0)[None, :]

    # Bilineal entre las cuatro esquinas del cuadro de la malla gruesa.
    c00 = coarse[np.ix_(y0, x0)]
    c01 = coarse[np.ix_(y0, x0 + 1)]
    c10 = coarse[np.ix_(y0 + 1, x0)]
    c11 = coarse[np.ix_(y0 + 1, x0 + 1)]

    top = c00 * (1.0 - tx) + c01 * tx
    bottom = c10 * (1.0 - tx) + c11 * tx
    return top * (1.0 - ty) + bottom * ty
