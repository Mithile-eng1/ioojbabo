"""Download the Elexon data used by the app into snapshot.json (run: python fetch_data.py)."""
import json, urllib.request
from pathlib import Path

BASE = "https://data.elexon.co.uk/bmrs/api/v1/datasets"


def get(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)


# Decisions made in Jan 2026 -> delivery days 2 Jan .. 1 Feb 2026.
actual = get(f"{BASE}/FUELHH/stream?settlementDateFrom=2026-01-02&settlementDateTo=2026-02-01&fuelType=WIND")
# Forecasts published up to the end of January (anything later can't inform a January decision).
forecast = get(f"{BASE}/WINDFOR/stream?publishDateTimeFrom=2025-12-30T00:00:00Z&publishDateTimeTo=2026-01-31T23:59:59Z")

out = {
    "actual": [[r["startTime"], r["generation"]] for r in actual],
    "forecast": [[r["startTime"], r["publishTime"], r["generation"]] for r in forecast],
}
Path(__file__).with_name("snapshot.json").write_text(json.dumps(out, separators=(",", ":")))
print(len(out["actual"]), "actual rows,", len(out["forecast"]), "forecast rows")
