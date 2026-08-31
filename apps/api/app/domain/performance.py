"""Error entre prediccion y realidad.

## Fuente de verdad

**Este modulo es la fuente de verdad conceptual.** Define las cuatro decisiones
que constituyen "el error" en CERES:

1. se divide por el valor REAL, no por el predicho (convencion del MAPE);
2. si el real es 0, el porcentaje es `None`, no un numero inventado;
3. se redondea a 4 decimales;
4. el redondeo es HALF-UP (0.00005 sube), no bancario.

La vista SQL `cell_performance` (migracion 0003) replica estas cuatro
decisiones para consultas ad-hoc y BI. Es un **espejo**, no una segunda
autoridad: si discrepan, el que esta mal es el SQL.

## Por que la duplicacion se mantiene

Eliminarla del todo tendria dos formas, y ninguna sale a cuenta:

- Que la API leyera la vista: ataria el endpoint a PostgreSQL y dejaria los
  tests de integracion en SQLite sin poder ejecutarlo (`LEFT JOIN LATERAL`).
- Que la vista dejara de calcular el error: quien consulte Supabase a mano o
  conecte un BI perderia justo la columna por la que existe la vista.

Lo que se duplica son dos restas y una division. Envolverlas en una funcion de
PostgreSQL generada desde Python seria mas maquinaria que la que ahorra. La
proteccion elegida es un test diferencial que ejecuta ambas implementaciones
sobre los mismos casos —incluidos los limite— contra el PostgreSQL real:
`tests/postgres/test_performance_parity.py`.

## Por que la aritmetica es decimal y no de coma flotante

La primera version restaba en `float` y redondeaba el resultado. Divergia, y el
motivo no era el modo de redondeo sino la resta:

    2.00005 - 1.0   ->  el mismo float8 en los dos lados
    Python  repr()      -> "1.0000499999999999"  -> 1.0000
    Postgres ::numeric  -> "1.00005"             -> 1.0001

PostgreSQL convierte `double precision` a `numeric` con 15 cifras
significativas (`extra_float_digits = 0`), asi que `1.00024999...` se le
convierte en un empate exacto que redondea hacia arriba. Python usa la
representacion mas corta que reproduce el float, 17 cifras, y ve un 4 en la
quinta posicion.

La solucion no es imitar la peculiaridad de nadie: es **no restar en binario**.
Cada operando se convierte a decimal por separado —donde ambos coinciden, porque
los valores almacenados tienen 4 decimales— y la resta y la division ocurren en
aritmetica decimal exacta. La vista SQL hace lo mismo castendo cada columna a
`numeric` antes de operar (migracion 0005).

El redondeo es HALF-UP porque es lo que hace `round(numeric, n)` de PostgreSQL y
lo que espera cualquiera que lea un porcentaje en un informe; `round()` de
Python usa redondeo bancario y daria `2.0` donde SQL da `2.0001`.

## Limite conocido

Si alguien insertara a mano un valor con mas de 15 cifras significativas
(`0.30000000000000004`), Python y PostgreSQL lo renderizarian distinto y los dos
lados podrian discrepar. No ocurre en CERES: el motor redondea las predicciones
a 4 decimales y las cosechas entran por un schema Pydantic. Queda anotado porque
es el unico resquicio que deja este diseno.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

#: Decimales de los errores. Debe coincidir con el ROUND de la vista SQL.
ERROR_DECIMALS = 4

#: Paso de cuantizacion: Decimal("0.0001").
_QUANTUM = Decimal(1).scaleb(-ERROR_DECIMALS)

#: Cien, en decimal, para el porcentaje.
_HUNDRED = Decimal(100)


def _to_decimal(value: float) -> Decimal:
    """Convierte un float al decimal que PostgreSQL veria al castearlo a numeric.

    `repr()` da la representacion decimal mas corta que reproduce el float, que
    para valores de 4 decimales —los unicos que CERES almacena— coincide con lo
    que produce `::numeric`.
    """
    return Decimal(repr(value))


def _quantize(value: Decimal) -> float:
    """Redondea a ERROR_DECIMALS con HALF-UP, igual que `round(x::numeric, 4)`."""
    return float(value.quantize(_QUANTUM, rounding=ROUND_HALF_UP))


def absolute_error_kg(projected_yield_kg: float, actual_yield_kg: float) -> float:
    """Diferencia en valor absoluto, en kg.

    La resta ocurre en decimal exacto, no en coma flotante: es lo que mantiene
    este resultado identico al de la vista SQL.
    """
    difference = _to_decimal(projected_yield_kg) - _to_decimal(actual_yield_kg)
    return _quantize(abs(difference))


def percentage_error(projected_yield_kg: float, actual_yield_kg: float) -> float | None:
    """Error relativo respecto al valor REAL, en porcentaje.

    Convencion estandar (la del MAPE): se divide por lo que de verdad ocurrio,
    no por lo que se predijo.

    Devuelve `None` si el rendimiento real es 0. Dividir por cero no produce un
    porcentaje enorme, no produce nada; es mejor decirlo que inventarse un
    numero que luego alguien promedie.
    """
    if actual_yield_kg == 0:
        return None

    actual = _to_decimal(actual_yield_kg)
    difference = abs(_to_decimal(projected_yield_kg) - actual)
    return _quantize(difference / actual * _HUNDRED)
