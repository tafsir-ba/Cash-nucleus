import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Checkbox } from "./ui/checkbox";
import {
  TOTAL_SERIES_ID,
  TOTAL_SERIES_KEY,
  TOTAL_CHART_COLOR,
  accountSeriesKey,
  buildCashPositionAccountOptions,
  buildCashPositionChartXDomain,
  buildMultiSeriesCashPositionChartData,
  colorForAccountIndex,
  formatChartDate,
} from "./cashPositionChart";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const formatCurrency = (amount) =>
  new Intl.NumberFormat("de-CH", {
    style: "currency",
    currency: "CHF",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount ?? 0);

/**
 * Inline daily cash evolution chart for the Treasury home page.
 * Checkboxes below the chart toggle Total + per-account series.
 */
export const CashPositionEvolutionChart = ({ accounts = [] }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [days, setDays] = useState([]);
  const [showTotal, setShowTotal] = useState(true);
  const [selectedAccountIds, setSelectedAccountIds] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await axios.get(`${API}/treasury/cash-position-history`, {
          params: { limit_days: 365 },
        });
        if (!cancelled) {
          setDays(Array.isArray(response.data?.days) ? response.data.days : []);
        }
      } catch {
        if (!cancelled) {
          setError("Unable to load cash position history.");
          setDays([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const accountOptions = useMemo(
    () => buildCashPositionAccountOptions(accounts, days),
    [accounts, days],
  );

  const chartData = useMemo(
    () => buildMultiSeriesCashPositionChartData(days, [...selectedAccountIds]),
    [days, selectedAccountIds],
  );

  const chartXDomain = useMemo(() => buildCashPositionChartXDomain(chartData), [chartData]);

  const visibleSeries = useMemo(() => {
    const series = [];
    if (showTotal) {
      series.push({
        id: TOTAL_SERIES_ID,
        dataKey: TOTAL_SERIES_KEY,
        label: "Total cash",
        color: TOTAL_CHART_COLOR,
      });
    }
    accountOptions.forEach((opt, index) => {
      if (!selectedAccountIds.has(opt.id)) return;
      series.push({
        id: opt.id,
        dataKey: accountSeriesKey(opt.id),
        label: opt.label,
        color: colorForAccountIndex(index),
      });
    });
    return series;
  }, [showTotal, selectedAccountIds, accountOptions]);

  const toggleAccount = (accountId) => {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  const noSeriesSelected = visibleSeries.length === 0;

  return (
    <div
      className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4"
      data-testid="cash-evolution-chart"
    >
      <p className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
        Daily Total Cash Position
      </p>
      <div className="h-[280px]">
        {loading ? (
          <div className="h-full flex items-center justify-center text-sm text-zinc-500">
            Loading chart...
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-sm text-rose-400">{error}</div>
        ) : chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-zinc-500">
            No snapshot history yet.
          </div>
        ) : noSeriesSelected ? (
          <div className="h-full flex items-center justify-center text-sm text-zinc-500">
            Select Total or an account below to show a series.
          </div>
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
              <YAxis
                stroke="#71717a"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => `${Math.round(v / 1000)}k`}
              />
              <Tooltip
                labelFormatter={(timestamp) => formatChartDate(timestamp)}
                formatter={(value, name) => [formatCurrency(value), name]}
                contentStyle={{
                  backgroundColor: "#09090b",
                  border: "1px solid #3f3f46",
                  color: "#f4f4f5",
                }}
              />
              {visibleSeries.map((series) => (
                <Line
                  key={series.id}
                  type="linear"
                  dataKey={series.dataKey}
                  name={series.label}
                  stroke={series.color}
                  strokeWidth={series.id === TOTAL_SERIES_ID ? 2 : 1.75}
                  dot={chartData.length <= 24}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div
        className="mt-3 pt-3 border-t border-zinc-800/80 flex flex-wrap gap-x-4 gap-y-2"
        data-testid="cash-evolution-series-selector"
      >
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
          <Checkbox
            checked={showTotal}
            onCheckedChange={(checked) => setShowTotal(checked === true)}
            data-testid="cash-evolution-toggle-total"
            className="border-zinc-500 data-[state=checked]:bg-zinc-100 data-[state=checked]:text-zinc-950"
          />
          <span
            className="w-2 h-2 rounded-sm shrink-0"
            style={{ backgroundColor: TOTAL_CHART_COLOR }}
            aria-hidden
          />
          Total cash
        </label>
        {accountOptions.map((opt, index) => {
          const color = colorForAccountIndex(index);
          const checked = selectedAccountIds.has(opt.id);
          return (
            <label
              key={opt.id}
              className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => toggleAccount(opt.id)}
                data-testid={`cash-evolution-toggle-account-${opt.id}`}
                className="border-zinc-500 data-[state=checked]:bg-zinc-100 data-[state=checked]:text-zinc-950"
              />
              <span
                className="w-2 h-2 rounded-sm shrink-0"
                style={{ backgroundColor: color }}
                aria-hidden
              />
              {opt.label}
            </label>
          );
        })}
        {!loading && accountOptions.length === 0 && (
          <span className="text-xs text-zinc-600">No accounts available for series selection.</span>
        )}
      </div>
    </div>
  );
};
