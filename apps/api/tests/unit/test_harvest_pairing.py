"""LA REGLA DE EMPAREJAMIENTO PREDICCION / COSECHA.

    una prediccion se compara con una cosecha si
        as_of < harvested_at a las 00:00 UTC

Existia un emparejamiento antes de esta fase y era temporal solo de nombre: toda
prediccion del ciclo se comparaba con la cosecha, sin mirar fechas. Se escribio
antes de que existiera `as_of`, y desde entonces afirmaba algo falso —que la
diferencia entre una prediccion POSTERIOR a la cosecha y el rendimiento real es
un error de prediccion—.

Estos tests fijan la regla en la fuente de verdad. La vista SQL la replica y la
paridad la vigila `tests/postgres/`.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.domain.performance import harvest_cutoff, prediction_precedes_harvest

COSECHA = date(2026, 6, 15)
CORTE = datetime(2026, 6, 15, tzinfo=timezone.utc)


def momento(iso: str) -> datetime:
    return datetime.fromisoformat(iso)


# --- El corte ----------------------------------------------------------------


def test_the_cutoff_is_midnight_utc_of_the_harvest_day():
    assert harvest_cutoff(COSECHA) == CORTE
    assert harvest_cutoff(COSECHA).tzinfo is timezone.utc


def test_the_instant_before_the_cutoff_counts():
    assert prediction_precedes_harvest(CORTE - timedelta(seconds=1), COSECHA) is True


def test_the_cutoff_itself_does_not():
    """Estrictamente anterior. El limite es exclusivo y esta documentado."""
    assert prediction_precedes_harvest(CORTE, COSECHA) is False


def test_a_prediction_from_the_harvest_day_does_not_count():
    """La decision conservadora, y la razon esta escrita en el dominio.

    La cosecha ocurrio en algun momento de ese dia y no sabemos cual: una
    prediccion de esa misma tarde pudo hacerse con el fruto ya recogido, y
    entonces no predijo nada. Entre perder un emparejamiento legitimo y afirmar
    un error de prediccion que no lo es, se pierde el emparejamiento.
    """
    assert prediction_precedes_harvest(momento("2026-06-15T14:00:00+00:00"), COSECHA) is False


def test_a_later_prediction_never_counts():
    assert prediction_precedes_harvest(momento("2026-07-01T00:00:00+00:00"), COSECHA) is False


def test_an_earlier_day_always_counts():
    for dia in ("2026-06-14", "2026-05-01", "2026-01-01"):
        assert prediction_precedes_harvest(momento(f"{dia}T12:00:00+00:00"), COSECHA) is True


# --- Casos que no son fechas normales ---------------------------------------


def test_a_prediction_without_as_of_never_pairs():
    """`NULL` es "el estado base, sin fechar".

    Un estado sin fecha no se puede situar antes ni despues de una cosecha, asi
    que no empareja. La alternativa —caer a `created_at`— reintroduciria la
    confusion que `as_of` vino a resolver.
    """
    assert prediction_precedes_harvest(None, COSECHA) is False


def test_a_naive_datetime_is_read_as_utc():
    """Segun el driver, la fecha vuelve con zona o sin ella.

    Es una propiedad del almacenamiento, no de la semantica: comparar sin
    normalizar reventaria con `can't compare offset-naive and offset-aware`.
    """
    assert prediction_precedes_harvest(datetime(2026, 6, 14, 23, 0), COSECHA) is True
    assert prediction_precedes_harvest(datetime(2026, 6, 16, 0, 0), COSECHA) is False


def test_the_rule_respects_the_offset_and_not_the_wall_clock():
    """Las 20:00 del 14 en Bogota son las 01:00 del 15 en UTC: no cuenta.

    Si la regla mirara la hora local del reloj en vez del instante, dos
    predicciones simultaneas emparejarian distinto segun quien las hubiera
    lanzado.
    """
    bogota = timezone(timedelta(hours=-5))
    tarde_del_14 = datetime(2026, 6, 14, 20, 0, tzinfo=bogota)

    assert tarde_del_14.astimezone(timezone.utc).day == 15
    assert prediction_precedes_harvest(tarde_del_14, COSECHA) is False


def test_the_rule_is_deterministic():
    """Misma entrada, misma respuesta. Sin relojes ni estado de sesion."""
    entrada = momento("2026-06-01T09:00:00+00:00")
    assert {prediction_precedes_harvest(entrada, COSECHA) for _ in range(50)} == {True}
