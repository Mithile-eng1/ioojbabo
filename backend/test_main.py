from fastapi.testclient import TestClient
from main import app

c = TestClient(app)


def test_day_uses_forecast_before_cutoff():
    r = c.get("/api/day?date=2026-01-15&cutoff_hour=9").json()
    # every forecast used must be published at/before 09:00 on 14 Jan
    assert all(p <= "2026-01-14 09:00" for p in r["forecast_published"])
    assert r["day_metrics"]["n"] == 24 and len(r["points"]) >= 24


def test_accuracy():
    r = c.get("/api/accuracy").json()
    assert len(r["daily"]) == 31 and r["overall"]["mae"] > 0
    assert r["overall"]["p10"] < r["overall"]["p90"]


if __name__ == "__main__":
    test_day_uses_forecast_before_cutoff(); test_accuracy(); print("ok")
