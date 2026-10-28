# GridBricks – wind forecast desk (GB day-ahead)

Web app for a day-ahead power buying desk: (1) shows the latest national wind forecast available at the day-ahead decision cut-off, (2) quantifies how accurate that forecast has been, for **January 2026 decisions** (delivery days 2 Jan – 1 Feb 2026). Data: Elexon BMRS only – `WINDFOR` (forecast) and `FUELHH` fuelType `WIND` (actual).

**Live app:** _<add Heroku/Vercel URL here>_
**AI disclosure:** built with Claude Code (Anthropic) assisting design, code and docs.

## What you get
- **Day view:** pick a delivery day; see the latest forecast published before the day-ahead cut-off (and its publish time), actual wind, a P10-P90 band, a plain-English decision brief, and a month overview (click a day to open it).
- **Forecast accuracy:** MAE, RMSE, weighted MAPE, bias, P05-P95 error, error histogram, forecast-vs-actual scatter, error by day / hour of day / forecast lead time, and the worst days.

## Layout
| Path | What |
|---|---|
| `backend/main.py` | FastAPI: `/api/meta`, `/api/day`, `/api/accuracy`; serves built UI from `static/` |
| `backend/fetch_data.py` | Downloads Elexon data to `snapshot.json` (already committed; Jan 2026 is history so it never changes) |
| `backend/test_main.py` | Two checks: no look-ahead in forecast selection, accuracy endpoint sanity |
| `frontend/` | React + Vite + Recharts (`src/App.jsx` is the whole UI) |
| `Dockerfile`, `heroku.yml` | Multi-stage build (UI → Python image); Heroku container deploy |

## Run
Docker: `docker build -t gridbricks . && docker run -p 8000:8000 gridbricks` → http://localhost:8000

Dev: `cd backend && pip install -r requirements.txt && uvicorn main:app --reload`, and in another shell `cd frontend && npm i && npm run dev` (proxies `/api`). Tests: `cd backend && python test_main.py`.

Deploy (Heroku): `heroku create && heroku stack:set container && git push heroku main`.

## Method (key assumptions)
- **Decision-time forecast:** for each target hour, the latest WINDFOR forecast published at or before a cut-off (default 09:00 UTC = UK time in Jan) on the day before delivery. GB day-ahead auctions close around 09:20–09:50 UK. The cut-off is adjustable in the UI.
- **Resolution:** forecasts are hourly, actuals half-hourly; errors are computed at the hourly timestamps where both exist.
- **Error = actual − forecast** (negative = wind under-delivered = extra power to buy). Metrics: MAE, RMSE, bias, weighted MAPE, P05–P95 error, worst shortfall; by day, hour of day and lead time.
- **Uncertainty band / "prudent wind":** forecast + P10/P90 of the month's error. This is in-sample (hindsight) for past days; a live version should use a rolling window.
- **Finding:** the forecast over-predicts on average by ~1.7 GW (FUELHH vs WINDFOR may differ in coverage, e.g. embedded wind – not verified).
- Out of scope: demand, prices, other fuels.
