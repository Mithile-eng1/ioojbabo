"""GridBricks API: latest wind forecast available at day-ahead gate closure, and its accuracy."""
import json
from functools import lru_cache
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

HERE = Path(__file__).parent
app = FastAPI(title="GridBricks")


@lru_cache
def raw():
    s = json.loads((HERE / "snapshot.json").read_text())
    a = pd.DataFrame(s["actual"], columns=["t", "actual"])
    f = pd.DataFrame(s["forecast"], columns=["t", "pub", "forecast"])
    for d, cols in ((a, ["t"]), (f, ["t", "pub"])):
        for c in cols:
            d[c] = pd.to_datetime(d[c], utc=True)
    return a, f


def decision_forecast(cutoff_hour: float) -> pd.DataFrame:
    """Per target hour: the latest forecast published at/before `cutoff_hour` UTC on the day before delivery.
    (Jan: UK time == UTC. Elexon day-ahead auctions close ~09:20-09:50 UK, so default cutoff is 09:00.)"""
    _, f = raw()
    cutoff = f.t.dt.normalize() - pd.Timedelta(days=1) + pd.Timedelta(hours=cutoff_hour)
    ok = f[f.pub <= cutoff].sort_values("pub")
    return ok.groupby("t", as_index=False).last()


def joined(cutoff_hour: float) -> pd.DataFrame:
    """Actuals (30 min) outer-joined with decision-time forecast (hourly), restricted to delivery days."""
    a, _ = raw()
    return a.merge(decision_forecast(cutoff_hour), on="t", how="outer").sort_values("t")


def metrics(d: pd.DataFrame) -> dict:
    d = d.dropna(subset=["actual", "forecast"])
    if d.empty:
        return {}
    e = d.actual - d.forecast  # +ve = wind came in above forecast
    q = e.quantile([.05, .1, .5, .9, .95])
    return {
        "n": len(d), "fc_avg": d.forecast.mean(), "ac_avg": d.actual.mean(), "mae": e.abs().mean(), "rmse": (e**2).mean() ** .5, "bias": e.mean(),
        "wmape": 100 * e.abs().sum() / d.actual.sum(),
        "p05": q[.05], "p10": q[.1], "p50": q[.5], "p90": q[.9], "p95": q[.95],
        "max_under": e.min(), "max_over": e.max(),  # worst shortfall / surplus vs forecast
    }


def clean(o):
    """NaN -> None, numpy/pandas scalars -> python, recursively."""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean(v) for v in o]
    if pd.isna(o):
        return None
    return o.item() if hasattr(o, "item") else o


def iso(s):
    return s.dt.strftime("%Y-%m-%dT%H:%M:%SZ")


@app.get("/api/meta")
def meta():
    a, _ = raw()
    return {"first_day": a.t.min().strftime("%Y-%m-%d"), "last_day": a.t.max().strftime("%Y-%m-%d")}


@app.get("/api/day")
def day(date: str, cutoff_hour: float = 9):
    d = joined(cutoff_hour)
    d = d[d.t.dt.strftime("%Y-%m-%d") == date]
    if d.empty:
        raise HTTPException(404, "No data for that day")
    # Uncertainty band from the whole-period error distribution (in-sample; see README).
    m_all = metrics(joined(cutoff_hour))
    pubs = sorted(d.pub.dropna().unique())
    pts = d.assign(t=iso(d.t), pub=d.pub.apply(lambda x: x.strftime("%Y-%m-%dT%H:%MZ") if pd.notna(x) else None))
    return clean({
        "date": date, "cutoff": f"{(pd.Timestamp(date) - pd.Timedelta(days=1)).date()} {int(cutoff_hour):02d}:{int(cutoff_hour % 1 * 60):02d}Z",
        "forecast_published": [pd.Timestamp(p).strftime("%Y-%m-%d %H:%M") for p in pubs],
        "points": pts[["t", "actual", "forecast"]].to_dict("records"),
        "day_metrics": metrics(d), "period_metrics": m_all,
        "forecast_mwh": d.forecast.sum() if d.forecast.notna().any() else None,
    })


@app.get("/api/accuracy")
def accuracy(cutoff_hour: float = 9):
    d = joined(cutoff_hour).dropna(subset=["actual", "forecast"])
    d = d.assign(day=d.t.dt.strftime("%Y-%m-%d"), hour=d.t.dt.hour)
    daily = [{"day": k, **metrics(g)} for k, g in d.groupby("day")]
    by_hour = [{"hour": k, **metrics(g)} for k, g in d.groupby("hour")]

    # Error vs lead time over every forecast vintage (not just the decision-time one).
    a, f = raw()
    x = f.merge(a, on="t")
    x = x.assign(h=(x.t - x.pub).dt.total_seconds() / 3600)
    x = x[x.h > 0]
    x["bin"] = (x.h // 6 * 6).astype(int)
    by_horizon = [{"bin": f"{k}-{k + 6}h", "start": k, **metrics(g)} for k, g in x.groupby("bin")]
    return clean({"overall": metrics(d), "daily": daily, "by_hour": by_hour, "by_horizon": by_horizon,
                  "errors": (d.actual - d.forecast).round(0).tolist(),
                  "pairs": d[["forecast", "actual"]].round(0).to_dict("records")})


if (HERE / "static").is_dir():  # built React app (Docker image)
    app.mount("/", StaticFiles(directory=HERE / "static", html=True))
