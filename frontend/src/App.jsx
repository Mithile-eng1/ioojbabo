import { useEffect, useState } from "react";
import { ResponsiveContainer, ComposedChart, BarChart, ScatterChart, Scatter, Cell, Bar, Line, Area, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine } from "recharts";

const C = { fc: "var(--fc)", ac: "var(--ac)" };
const mw = (v) => (v == null ? "–" : Math.round(v).toLocaleString() + " MW");
const useApi = (url) => {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setD(null); setErr(null);
    fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(r.statusText))).then(setD).catch(setErr);
  }, [url]);
  return [d, err];
};
const Kpi = ({ v, l }) => <div className="kpi"><b>{v}</b><span>{l}</span></div>;
const Chart = ({ children, h = 280 }) => <ResponsiveContainer width="100%" height={h}>{children}</ResponsiveContainer>;
const axes = (x, unit = "MW") => [
  <CartesianGrid key="g" stroke="var(--line)" strokeDasharray="3 3" vertical={false} />,
  <XAxis key="x" dataKey={x} stroke="var(--mute)" fontSize={12} tickLine={false} axisLine={false} />,
  <YAxis key="y" stroke="var(--mute)" fontSize={12} width={55} tickLine={false} axisLine={false} label={unit === "MW" ? { value: "MW", angle: -90, position: "insideLeft", fill: "var(--mute)", fontSize: 12 } : undefined} />,
  <Tooltip key="t" contentStyle={{ background: "var(--card2)", border: "1px solid var(--line)", borderRadius: 2, color: "var(--ink)" }} cursor={{ fill: "#00000008" }} formatter={(v) => (Array.isArray(v) ? v.map(Math.round).join(" – ") : Math.round(v))} />,
];
const shift = (date, n) => new Date(Date.parse(date) + n * 864e5).toISOString().slice(0, 10);

function Day({ meta, cutoff }) {
  const [date, setDate] = useState("2026-01-15");
  const [d, err] = useApi(`/api/day?date=${date}&cutoff_hour=${cutoff}`);
  const [acc] = useApi(`/api/accuracy?cutoff_hour=${cutoff}`);
  const pm = d?.period_metrics, dm = d?.day_metrics;
  const rows = d?.points.map((p) => ({
    ...p, time: p.t.slice(11, 16),
    band: p.forecast == null ? null : [p.forecast + pm.p10, p.forecast + pm.p90],
    prudent: p.forecast == null ? null : p.forecast + pm.p10,
  }));
  const avg = (k) => rows && rows.filter((r) => r[k] != null).reduce((s, r, _, a) => s + r[k] / a.length, 0);
  return (
    <>
      <div className="controls">
        <button className="btn" disabled={date <= meta.first_day} onClick={() => setDate(shift(date, -1))}>←</button>
        <label>Delivery day<input type="date" value={date} min={meta.first_day} max={meta.last_day} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
        <button className="btn" disabled={date >= meta.last_day} onClick={() => setDate(shift(date, 1))}>→</button>
      </div>
      {err && <p>Could not load: {String(err)}</p>}
      {d && (
        <>
          <div className="card brief">
            <h2>Decision brief · {d.date}</h2>
            <p>
              At the cut-off ({d.cutoff}) the latest forecast was published <b>{d.forecast_published.join(", ")} UTC</b>. It expects wind to average <b>{mw(avg("forecast"))}</b>.
              Historically that forecast has run {pm.bias < 0 ? "high" : "low"} by {mw(Math.abs(pm.bias))} on average, and in 1 hour in 10 wind fell more than {mw(-pm.p10)} short.
              A prudent plan therefore assumes about <b>{mw(avg("prudent"))}</b> of wind, so budget up to <b>{mw(avg("forecast") - avg("prudent"))}</b> of extra thermal/market purchase on top of the forecast-based requirement.
            </p>
          </div>
          <div className="kpis">
            <Kpi v={mw(avg("forecast"))} l="Forecast wind, day average" />
            <Kpi v={mw(avg("prudent"))} l="Prudent wind (forecast + P10 error), avg" />
            <Kpi v={mw(avg("actual"))} l="Actual wind, day average" />
            <Kpi v={mw(dm.mae)} l="Day MAE (hindsight)" />
            <Kpi v={mw(dm.bias)} l="Day bias, actual − forecast (hindsight)" />
          </div>
          <div className="card">
            <h2>Wind generation: forecast vs actual</h2>
            <Chart h={340}>
              <ComposedChart data={rows}>
                {axes("time")}
                <Legend />
                <Area dataKey="band" name="P10–P90 band" stroke="none" fill="var(--fc)" fillOpacity={0.13} isAnimationActive={false} connectNulls />
                <Line dataKey="forecast" name="Forecast (at cut-off)" stroke={C.fc} dot={false} type="stepAfter" strokeWidth={2} connectNulls isAnimationActive={false} />
                <Line dataKey="actual" name="Actual" stroke={C.ac} dot={false} strokeWidth={2} isAnimationActive={false} />
              </ComposedChart>
            </Chart>
            <p className="note">
              Band = forecast plus the 10th/90th percentile of January forecast error ({mw(pm.p10)} / {mw(pm.p90)}). Computed over the whole month, so it is hindsight for past days; for live use it would be rolling.
              The forecast is hourly, actuals half-hourly.
            </p>
          </div>
          {acc && (
            <div className="card">
              <h2>January at a glance: daily average wind (click a bar to open that day)</h2>
              <Chart h={220}>
                <ComposedChart data={acc.daily.map((x) => ({ ...x, d: x.day.slice(8) }))} onClick={(e) => e?.activePayload && setDate(e.activePayload[0].payload.day)}>
                  {axes("d")}<Legend />
                  <Bar dataKey="fc_avg" name="Forecast avg" fill={C.fc} isAnimationActive={false} cursor="pointer" />
                  <Bar dataKey="ac_avg" name="Actual avg" fill={C.ac} isAnimationActive={false} cursor="pointer" />
                </ComposedChart>
              </Chart>
            </div>
          )}
        </>
      )}
    </>
  );
}

function Accuracy({ cutoff }) {
  const [d, err] = useApi(`/api/accuracy?cutoff_hour=${cutoff}`);
  if (err) return <p>Could not load: {String(err)}</p>;
  if (!d) return <p>Loading…</p>;
  const o = d.overall;
  const short = Math.round((100 * d.errors.filter((e) => e < 0).length) / d.errors.length);
  const lo = Math.floor(Math.min(...d.errors) / 1000) * 1000, bins = {};
  d.errors.forEach((e) => { const b = Math.floor((e - lo) / 1000) * 1000 + lo; bins[b] = (bins[b] || 0) + 1; });
  const hist = Object.keys(bins).map(Number).sort((a, b) => a - b).map((b) => ({ b, bin: `${b / 1000}k`, n: bins[b] }));
  const daily = d.daily.map((x) => ({ ...x, d: x.day.slice(5) }));
  const worst = [...d.daily].sort((a, b) => a.max_under - b.max_under).slice(0, 5);
  const hr = [...d.by_hour].sort((a, b) => b.mae - a.mae)[0];
  const h0 = d.by_horizon[0], h1 = d.by_horizon[d.by_horizon.length - 1];
  const tip = <Tooltip contentStyle={{ background: "var(--card2)", border: "1px solid var(--line)", borderRadius: 2, color: "var(--ink)" }} cursor={{ fill: "#00000008" }} formatter={(v) => Math.round(v)} />;
  return (
    <>
      <div className="card brief">
        <h2>What the numbers say</h2>
        <p>
          Across {o.n} hourly forecasts the typical miss is <b>{mw(o.mae)}</b> ({o.wmape.toFixed(1)}% of generation). The forecast is <b>biased high</b>:
          wind came in below forecast in <b>{short}%</b> of hours, by {mw(-o.bias)} on average. Plan for shortfalls of up to <b>{mw(-o.p10)}</b> (1-in-10) and <b>{mw(-o.p05)}</b> (1-in-20);
          the worst hour was <b>{mw(-o.max_under)}</b> short. Errors are largest around <b>{hr.hour}:00 UTC</b>, and they grow with lead time
          ({mw(h0.mae)} MAE at {h0.bin} vs {mw(h1.mae)} at {h1.bin}), so the latest vintage before the cut-off matters.
        </p>
      </div>
      <div className="kpis">
        <Kpi v={mw(o.mae)} l="MAE" />
        <Kpi v={mw(o.rmse)} l="RMSE" />
        <Kpi v={o.wmape.toFixed(1) + "%"} l="Weighted MAPE (Σ|err| / Σ actual)" />
        <Kpi v={mw(o.bias)} l="Bias (actual − forecast)" />
        <Kpi v={`${mw(o.p10)} / ${mw(o.p90)}`} l="P10 / P90 error" />
        <Kpi v={short + "%"} l="Hours below forecast" />
      </div>
      <div className="grid2">
        <div className="card">
          <h2>Error distribution (actual − forecast)</h2>
          <Chart>
            <BarChart data={hist}>{axes("bin", "")}
              <Bar dataKey="n" name="hours" isAnimationActive={false}>{hist.map((h) => <Cell key={h.b} fill={h.b < 0 ? "var(--bad)" : "var(--good)"} />)}</Bar>
            </BarChart>
          </Chart>
          <p className="note">Bins of 1,000 MW (label = lower edge). Red = wind below forecast (buy extra); green = above forecast.</p>
        </div>
        <div className="card">
          <h2>Forecast vs actual (every hour)</h2>
          <Chart>
            <ScatterChart>
              <CartesianGrid stroke="var(--line)" />
              <XAxis type="number" dataKey="forecast" name="Forecast" stroke="var(--mute)" fontSize={12} domain={[0, 22000]} />
              <YAxis type="number" dataKey="actual" name="Actual" stroke="var(--mute)" fontSize={12} domain={[0, 22000]} width={55} />
              {tip}
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 22000, y: 22000 }]} stroke="var(--mute)" strokeDasharray="4 4" />
              <Scatter data={d.pairs} fill={C.fc} fillOpacity={0.45} isAnimationActive={false} />
            </ScatterChart>
          </Chart>
          <p className="note">Dashed line = perfect forecast. Points below it are hours where wind under-delivered.</p>
        </div>
        <div className="card">
          <h2>Daily error: MAE and signed bias</h2>
          <Chart>
            <ComposedChart data={daily}>{axes("d")}<Legend /><ReferenceLine y={0} stroke="var(--mute)" />
              <Bar dataKey="bias" name="Bias (actual − forecast)" fill="var(--bad)" isAnimationActive={false} />
              <Line dataKey="mae" name="MAE" stroke={C.fc} dot={false} strokeWidth={2} isAnimationActive={false} />
            </ComposedChart>
          </Chart>
        </div>
        <div className="card">
          <h2>By hour of day (UTC)</h2>
          <Chart>
            <ComposedChart data={d.by_hour}>{axes("hour")}<Legend /><ReferenceLine y={0} stroke="var(--mute)" />
              <Bar dataKey="bias" name="Bias" fill="var(--bad)" isAnimationActive={false} />
              <Line dataKey="mae" name="MAE" stroke={C.fc} dot={false} strokeWidth={2} isAnimationActive={false} />
            </ComposedChart>
          </Chart>
        </div>
        <div className="card">
          <h2>Error vs forecast lead time (all vintages)</h2>
          <Chart>
            <ComposedChart data={d.by_horizon}>{axes("bin")}<Legend />
              <Bar dataKey="mae" name="MAE" fill={C.fc} isAnimationActive={false} />
              <Line dataKey="rmse" name="RMSE" stroke={C.ac} strokeWidth={2} isAnimationActive={false} />
            </ComposedChart>
          </Chart>
          <p className="note">Lead time = target time − publish time. Day-ahead decisions use forecasts 15–39 h ahead.</p>
        </div>
        <div className="card">
          <h2>Five worst days (largest shortfall)</h2>
          <table>
            <thead><tr><th>Day</th><th>Worst hour</th><th>MAE</th><th>Bias</th></tr></thead>
            <tbody>{worst.map((w) => <tr key={w.day}><td>{w.day}</td><td>{mw(w.max_under)}</td><td>{mw(w.mae)}</td><td>{mw(w.bias)}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default function App() {
  const [tab, setTab] = useState(location.hash === "#acc" ? "acc" : "day");
  const [cutoff, setCutoff] = useState(9);
  const [meta] = useApi("/api/meta");
  return (
    <main>
      <header className="hero">
        <div>
          <h1>GridBricks</h1>
          <p className="sub">Great Britain wind forecast desk · day-ahead decisions made in January 2026</p>
        </div>
        <div className="nav">
          <div className="pills">
            <button className={tab === "day" ? "on" : ""} onClick={() => setTab("day")}>Day view</button>
            <button className={tab === "acc" ? "on" : ""} onClick={() => setTab("acc")}>Forecast accuracy</button>
          </div>
          <label className="cut">Cut-off, UTC hour<input type="number" min="0" max="23" step="0.5" value={cutoff} onChange={(e) => setCutoff(Math.min(23, Math.max(0, +e.target.value)))} /></label>
        </div>
      </header>
      {meta && (tab === "day" ? <Day meta={meta} cutoff={cutoff} /> : <Accuracy cutoff={cutoff} />)}
    </main>
  );
}
