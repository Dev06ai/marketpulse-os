from app.analytics import compute_features
from app.models import Candle, MarketState


def c(i, o, h, l, cl, confirmed=True):
    return Candle(i * 900000, (i + 1) * 900000, o, h, l, cl, 100, confirmed)


def test_features_detect_trend_and_book_imbalance():
    cs = [c(i, 100 + i, 102 + i, 99 + i, 101 + i) for i in range(24)]
    state = MarketState(
        candles_15=cs,
        candles_60=cs,
        last_price=124,
        book_imbalance=0.25,
        spread_bps=1.2,
        oi_window=[(0, 1000), (300000, 1010), (600000, 1025)],
        cvd_history=[(0, 0.0), (900000, 10.0), (1800000, 20.0)],
        data_health="HEALTHY",
    )
    f = compute_features(state)
    assert f.trend_15 == "UP"
    assert f.book_imbalance == 0.25
    assert f.spread_bps == 1.2


def test_features_detects_cvd_divergence():
    cs = [c(i, 100, 101 + i * 0.2, 99, 101 + i * 0.2) for i in range(24)]
    state = MarketState(
        candles_15=cs,
        candles_60=cs,
        last_price=105,
        cvd_history=[(0, 100.0), (900000, 90.0), (1800000, 80.0), (2700000, 70.0), (3600000, 60.0), (4500000, 50.0)],
        data_health="HEALTHY",
    )
    f = compute_features(state)
    assert f.cvd_price_divergence in {"BEARISH", "NONE"}
