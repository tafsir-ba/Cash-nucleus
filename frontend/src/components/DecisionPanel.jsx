import { useState, useEffect, useCallback } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const formatCHF = (val) => {
  if (val == null) return "—";
  const abs = Math.abs(val);
  if (abs >= 1000) return `${(val / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return val.toFixed(0);
};

// ============== RUNWAY CARD ==============
const RunwayCard = ({ runway }) => {
  if (!runway) return null;
  const { committed, likely } = runway;

  return (
    <div className="surface-card p-4" data-testid="runway-card">
      <h3 className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-medium mb-3">Cash Runway</h3>
      <div className="flex gap-4">
        {["committed", "likely"].map((sc) => {
          const r = runway[sc];
          const isSafe = r.is_safe;
          return (
            <div key={sc} className="flex-1">
              <div className="text-[10px] text-zinc-500 capitalize mb-1">{sc}</div>
              {isSafe ? (
                <div className="text-emerald-400 text-sm font-semibold" data-testid={`runway-${sc}`}>
                  Safe
                  <span className="text-[10px] text-zinc-500 font-normal ml-1">({r.runway_months}M+)</span>
                </div>
              ) : (
                <div data-testid={`runway-${sc}`}>
                  <span className={`text-sm font-semibold ${r.months_until_breach <= 3 ? 'text-rose-400' : r.months_until_breach <= 6 ? 'text-amber-400' : 'text-zinc-300'}`}>
                    {r.months_until_breach} months
                  </span>
                  <div className="text-[10px] text-zinc-600">
                    Breach in {r.breach_month}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============== SCENARIO DELTA CARD ==============
const ScenarioDeltaCard = ({ delta }) => {
  if (!delta) return null;
  const gap = delta.total_gap_net;

  return (
    <div className="surface-card p-4" data-testid="scenario-delta-card">
      <h3 className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-medium mb-3">
        Scenario Gap <span className="text-zinc-600 normal-case tracking-normal">(Likely - Committed)</span>
      </h3>
      <div className={`text-lg font-semibold font-mono ${gap > 0 ? 'text-emerald-400' : gap < 0 ? 'text-rose-400' : 'text-zinc-400'}`}
        data-testid="scenario-gap-total">
        {gap > 0 ? '+' : ''}{formatCHF(gap)}
      </div>
      <div className="mt-3 flex gap-1 overflow-x-auto">
        {delta.months.slice(0, 12).map((m) => {
          const g = m.gap_net;
          const maxAbs = Math.max(...delta.months.map((mm) => Math.abs(mm.gap_net)), 1);
          const height = Math.min(Math.abs(g) / maxAbs * 24, 24);
          return (
            <div key={m.month} className="flex flex-col items-center gap-0.5 flex-1 min-w-[20px]"
              title={`${m.month_label}: Gap ${g > 0 ? '+' : ''}${formatCHF(g)}`}>
              <div className="h-6 flex items-end">
                <div
                  className={`w-full rounded-sm ${g > 0 ? 'bg-emerald-500/40' : g < 0 ? 'bg-rose-500/40' : 'bg-zinc-700'}`}
                  style={{ height: `${Math.max(height, 2)}px` }}
                />
              </div>
              <span className="text-[8px] text-zinc-600">{m.month_label.split(' ')[0].substring(0, 1)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============== TOP DRIVERS CARD ==============
const DriversCard = ({ drivers }) => {
  if (!drivers || drivers.negative_months.length === 0) return null;

  return (
    <div className="surface-card p-4" data-testid="drivers-card">
      <h3 className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-medium mb-3">
        Top Drivers of Negative Months
      </h3>
      <div className="space-y-3 max-h-[280px] overflow-y-auto">
        {drivers.negative_months.slice(0, 6).map((m) => (
          <div key={m.month} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-300 font-medium">{m.month_label}</span>
              <span className={`text-[10px] font-mono ${m.cash_balance < 0 ? 'text-rose-400' : 'text-zinc-500'}`}>
                bal: {formatCHF(m.cash_balance)}
              </span>
            </div>
            {m.drivers.map((d, i) => (
              <div key={i} className="flex items-center justify-between pl-2">
                <span className="text-[10px] text-zinc-500 truncate max-w-[140px]">
                  {d.label}{d.count > 1 ? ` (${d.count}x)` : ''}
                </span>
                <span className="text-[10px] font-mono text-rose-400/70">{formatCHF(d.amount)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

// ============== VARIANCE INSIGHT CARD ==============
const VarianceInsightCard = ({ variance }) => {
  if (!variance || variance.actuals_recorded === 0) return null;

  return (
    <div className="surface-card p-4" data-testid="variance-insight-card">
      <h3 className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-medium mb-3">
        Variance Control
      </h3>
      <div className="space-y-2">
        <div className="flex justify-between items-baseline">
          <span className="text-[10px] text-zinc-500">Net Impact</span>
          <span className={`text-sm font-semibold font-mono ${
            variance.net_variance_impact > 0 ? 'text-emerald-400' : variance.net_variance_impact < 0 ? 'text-rose-400' : 'text-zinc-400'
          }`} data-testid="variance-net-impact">
            {variance.net_variance_impact > 0 ? '+' : ''}{formatCHF(variance.net_variance_impact)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="bg-zinc-800/30 rounded p-1.5">
            <div className="text-zinc-600">Underperformance</div>
            <div className="text-amber-400 font-mono font-medium" data-testid="variance-under">
              {formatCHF(variance.total_underperformance)}
            </div>
          </div>
          <div className="bg-zinc-800/30 rounded p-1.5">
            <div className="text-zinc-600">Overperformance</div>
            <div className="text-emerald-400 font-mono font-medium" data-testid="variance-over">
              {formatCHF(variance.total_overperformance)}
            </div>
          </div>
          <div className="bg-zinc-800/30 rounded p-1.5">
            <div className="text-zinc-600">Carried Forward</div>
            <div className="text-amber-400/70 font-mono font-medium" data-testid="variance-carried">
              {formatCHF(variance.total_carried_forward)}
            </div>
          </div>
          <div className="bg-zinc-800/30 rounded p-1.5">
            <div className="text-zinc-600">Written Off</div>
            <div className="text-zinc-500 font-mono font-medium" data-testid="variance-written-off">
              {formatCHF(variance.total_written_off)}
            </div>
          </div>
        </div>
        <div className="text-[9px] text-zinc-600 text-right">
          {variance.actuals_recorded} actuals recorded
        </div>
      </div>
    </div>
  );
};

// ============== MAIN DECISION PANEL ==============
export const DecisionPanel = ({ scenario, selectedEntityId, horizon, refreshKey }) => {
  const [runway, setRunway] = useState(null);
  const [delta, setDelta] = useState(null);
  const [drivers, setDrivers] = useState(null);
  const [variance, setVariance] = useState(null);

  const fetchAll = useCallback(async () => {
    const params = { horizon };
    if (selectedEntityId) params.entity_id = selectedEntityId;
    const varParams = selectedEntityId ? { entity_id: selectedEntityId } : {};

    try {
      const [runwayRes, deltaRes, driversRes, varianceRes] = await Promise.all([
        axios.get(`${API}/projection/runway`, { params }),
        axios.get(`${API}/projection/scenario-delta`, { params }),
        axios.get(`${API}/projection/drivers`, { params: { ...params, scenario } }),
        axios.get(`${API}/variance-summary`, { params: varParams }),
      ]);
      setRunway(runwayRes.data);
      setDelta(deltaRes.data);
      setDrivers(driversRes.data);
      setVariance(varianceRes.data);
    } catch (err) {
      console.error("Decision panel fetch error:", err);
    }
  }, [scenario, selectedEntityId, horizon]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll, refreshKey]);

  return (
    <div className="space-y-3" data-testid="decision-panel">
      <RunwayCard runway={runway} />
      <ScenarioDeltaCard delta={delta} />
      <DriversCard drivers={drivers} />
      <VarianceInsightCard variance={variance} />
    </div>
  );
};
