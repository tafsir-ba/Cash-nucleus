import { Fragment, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  buildCashPositionChartData,
  buildCashPositionChartXDomain,
  formatChartDate,
} from "./cashPositionChart";
import { API, isRequestCanceled } from "../lib/api";

const formatCurrency = (amount) =>
  new Intl.NumberFormat("de-CH", {
    style: "currency",
    currency: "CHF",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount ?? 0);

const fmtMovement = (delta) => {
  if (delta == null) return "—";
  const abs = Math.abs(delta);
  const base = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 }).format(abs);
  if (delta > 0) return `+${base}`;
  if (delta < 0) return `−${base}`;
  return base;
};

const emptyHistory = { days: [], account_audit_log: [] };

const normalizeHistory = (payload) => ({
  days: Array.isArray(payload?.days) ? payload.days : [],
  account_audit_log: Array.isArray(payload?.account_audit_log) ? payload.account_audit_log : [],
});

export const CashPositionHistoryDialog = ({ open, onOpenChange, entities: entitiesProp }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(emptyHistory);
  const [fetchedEntities, setFetchedEntities] = useState([]);
  const [entityFilter, setEntityFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [expandedDate, setExpandedDate] = useState(null);

  const entities = Array.isArray(entitiesProp) && entitiesProp.length > 0 ? entitiesProp : fetchedEntities;

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = {};
        if (accountFilter !== "all") params.account_id = accountFilter;
        if (entityFilter !== "all") params.entity_id = entityFilter;
        const response = await axios.get(`${API}/treasury/cash-position-history`, {
          params,
          signal: controller.signal,
        });
        setData(normalizeHistory(response.data));
      } catch (err) {
        if (isRequestCanceled(err) || controller.signal.aborted) return;
        setError("Unable to load cash position history.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    run();
    return () => controller.abort();
  }, [open, entityFilter, accountFilter]);

  useEffect(() => {
    if (!open) return undefined;
    if (Array.isArray(entitiesProp) && entitiesProp.length > 0) return undefined;
    const controller = new AbortController();
    const loadEntities = async () => {
      try {
        const response = await axios.get(`${API}/entities`, { signal: controller.signal });
        if (!controller.signal.aborted) {
          setFetchedEntities(Array.isArray(response.data) ? response.data : []);
        }
      } catch (err) {
        if (isRequestCanceled(err) || controller.signal.aborted) return;
        setFetchedEntities([]);
      }
    };
    loadEntities();
    return () => controller.abort();
  }, [open, entitiesProp]);

  const days = data.days;
  const auditLog = data.account_audit_log;

  const accountOptions = useMemo(() => {
    const map = new Map();
    days.forEach((d) =>
      d.changed_accounts?.forEach((a) => {
        if (!map.has(a.account_id)) map.set(a.account_id, a.account_name);
      }),
    );
    return [...map.entries()].map(([id, label]) => ({ id, label }));
  }, [days]);

  const chartData = useMemo(() => buildCashPositionChartData(days), [days]);

  const chartXDomain = useMemo(() => buildCashPositionChartXDomain(chartData), [chartData]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-zinc-950 border-zinc-800 max-w-5xl max-h-[92vh] overflow-y-auto"
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-zinc-100 font-heading">Cash Position History</DialogTitle>
          <DialogDescription className="text-zinc-500">
            Actual bank-account balance snapshots and audit trail. Projected movements remain separate.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-200"
          >
            <option value="all">All entities</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </select>
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-200"
          >
            <option value="all">All accounts</option>
            {accountOptions.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.label}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Daily Total Cash Position</p>
          <div className="h-[280px]">
            {loading ? (
              <div className="h-full flex items-center justify-center text-sm text-zinc-500">Loading chart...</div>
            ) : error ? (
              <div className="h-full flex items-center justify-center text-sm text-rose-400">{error}</div>
            ) : chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-zinc-500">No snapshot history yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis
                    dataKey="timestamp"
                    type="number"
                    scale="time"
                    domain={chartXDomain}
                    stroke="#71717a"
                    tick={{ fontSize: 11 }}
                    tickFormatter={formatChartDate}
                    padding={{ left: 12, right: 12 }}
                  />
                  <YAxis stroke="#71717a" tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip
                    labelFormatter={(timestamp) => formatChartDate(timestamp)}
                    formatter={(value) => formatCurrency(value)}
                    contentStyle={{ backgroundColor: "#09090b", border: "1px solid #3f3f46", color: "#f4f4f5" }}
                  />
                  <Line
                    type="linear"
                    dataKey="total_cash_chf"
                    stroke="#e4e4e7"
                    strokeWidth={2}
                    dot={chartData.length <= 24}
                    connectNulls
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full">
            <thead className="bg-zinc-900">
              <tr className="border-b border-zinc-800">
                <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-zinc-500">Date</th>
                <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-zinc-500">Total Cash</th>
                <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-zinc-500">Movement</th>
                <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-zinc-500">Trigger</th>
                <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-zinc-500">User / Time</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-3 py-4 text-sm text-zinc-500" colSpan={5}>
                    Loading history...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td className="px-3 py-4 text-sm text-rose-400" colSpan={5}>
                    {error}
                  </td>
                </tr>
              ) : days.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-sm text-zinc-500" colSpan={5}>
                    No snapshot history yet.
                  </td>
                </tr>
              ) : (
                days.map((day) => (
                  <Fragment key={day.date}>
                    <tr
                      className="border-b border-zinc-800/60 hover:bg-zinc-900/40 cursor-pointer"
                      onClick={() => setExpandedDate(expandedDate === day.date ? null : day.date)}
                    >
                      <td className="px-3 py-2 text-sm text-zinc-200">{day.date}</td>
                      <td className="px-3 py-2 text-sm text-zinc-100 font-mono">{formatCurrency(day.total_cash_chf)}</td>
                      <td
                        className={`px-3 py-2 text-xs font-mono ${
                          (day.movement_chf ?? 0) > 0
                            ? "text-emerald-400"
                            : (day.movement_chf ?? 0) < 0
                              ? "text-rose-400"
                              : "text-zinc-500"
                        }`}
                      >
                        {fmtMovement(day.movement_chf)}
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-400">{day.trigger}</td>
                      <td className="px-3 py-2 text-xs text-zinc-500">
                        {day.created_by} · {new Date(day.created_at).toLocaleString()}
                      </td>
                    </tr>
                    {expandedDate === day.date && (
                      <tr className="border-b border-zinc-800">
                        <td colSpan={5} className="px-3 py-3 bg-zinc-900/20">
                          <p className="text-xs text-zinc-500 mb-2">Account-level movements causing the change</p>
                          {day.changed_accounts?.length ? (
                            <div className="space-y-1">
                              {day.changed_accounts.map((acc) => (
                                <div key={`${day.date}-${acc.account_id}`} className="flex items-center justify-between text-sm">
                                  <span className="text-zinc-300">
                                    {acc.account_name} <span className="text-zinc-600">({acc.entity})</span>
                                  </span>
                                  <span className="text-zinc-100 font-mono">
                                    {fmtMovement(acc.movement_chf)} · {formatCurrency(acc.balance_chf)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-zinc-600">No account movement details for current filter.</p>
                          )}
                          {day.note && <p className="text-xs text-zinc-500 mt-2">Note: {day.note}</p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
          <p className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Manual balance adjustment audit log</p>
          <div className="space-y-1 max-h-44 overflow-y-auto">
            {auditLog.length === 0 ? (
              <p className="text-xs text-zinc-600">No manual audit entries yet.</p>
            ) : (
              auditLog.slice(0, 50).map((row) => (
                <div key={row.id} className="text-xs text-zinc-400 flex flex-wrap items-center gap-2 border-b border-zinc-800/60 pb-1">
                  <span className="font-mono text-zinc-300">{new Date(row.changed_at).toLocaleString()}</span>
                  <span>{row.account_id}</span>
                  <span className="font-mono">
                    {formatCurrency(row.previous_balance_chf)} → {formatCurrency(row.new_balance_chf)}
                  </span>
                  <span className={(row.delta_chf || 0) >= 0 ? "text-emerald-400 font-mono" : "text-rose-400 font-mono"}>
                    {fmtMovement(row.delta_chf)}
                  </span>
                  <span>{row.changed_by}</span>
                  {row.note && <span className="text-zinc-500">Note: {row.note}</span>}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 text-xs text-zinc-500">
          <p className="mb-1">Separation of concerns</p>
          <ul className="list-disc ml-4 space-y-1">
            <li>Actual balance edits/imports/recalculations are shown in this history.</li>
            <li>Projected cash movements and receivables/payables assumptions stay in projection views.</li>
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
};
