import { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  ReferenceDot,
} from 'recharts';

const formatCurrency = (amount) => {
  if (Math.abs(amount) >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1000) return `${(amount / 1000).toFixed(0)}K`;
  return amount.toFixed(0);
};

const formatFullCurrency = (amount) => {
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency: 'CHF',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const localCalendarMonthKey = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
};

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 shadow-xl">
        <p className="text-zinc-400 text-xs font-medium mb-2">{data.month_label}</p>
        <div className="space-y-1">
          <p className="text-zinc-100 text-sm font-mono">Cash: {formatFullCurrency(data.closing_cash)}</p>
          <p className="text-emerald-400 text-xs font-mono">In: +{formatFullCurrency(data.inflows)}</p>
          <p className="text-rose-400 text-xs font-mono">Out: -{formatFullCurrency(data.outflows)}</p>
        </div>
      </div>
    );
  }
  return null;
};

export const ProjectionChart = ({ projection, selectedMonth, onMonthSelect, hasData, horizon = 12 }) => {
  /** How many calendar months before "now" to include on the chart (full series stays in API/table). */
  const [pastSpan, setPastSpan] = useState(2);

  const months = projection?.months ?? [];
  const monthCount = months.length;

  const chartData = useMemo(() => {
    if (!months.length) return [];
    if (pastSpan === 'all') return months;
    const curKey = localCalendarMonthKey();
    const curIdx = months.findIndex((m) => m.month === curKey);
    const anchor = curIdx >= 0 ? curIdx : Math.max(0, months.length - 1);
    const from = Math.max(0, anchor - pastSpan);
    return months.slice(from);
  }, [months, pastSpan]);

  if (!projection || !hasData) {
    return (
      <div className="chart-container h-[340px] flex flex-col items-center justify-center" data-testid="chart-projection">
        <p className="text-zinc-500 text-sm mb-2">Add cash or flows to see projection</p>
        <p className="text-zinc-600 text-xs">Your forecast will appear here</p>
      </div>
    );
  }

  const { safety_buffer, lowest_cash, lowest_cash_month, first_watch_month, first_danger_month } = projection;

  const chartMonthCount = chartData.length;

  const lowestInChart = chartData.length
    ? chartData.reduce((best, m) => (m.closing_cash < best.closing_cash ? m : best), chartData[0])
    : null;
  const firstWatchInChart = chartData.find((m) => m.month_label === first_watch_month);
  const firstDangerInChart = chartData.find((m) => m.month_label === first_danger_month);

  const allValues = chartData.map((m) => m.closing_cash);
  const minValue = allValues.length ? Math.min(...allValues, 0) : 0;
  const maxValue = allValues.length ? Math.max(...allValues, safety_buffer) : safety_buffer;
  const range = maxValue - minValue;
  const padding = Math.max(range * 0.15, 5000);
  const yMin = Math.floor((minValue - padding) / 5000) * 5000;
  const yMax = Math.ceil((maxValue + padding) / 5000) * 5000;

  const currentMonth = localCalendarMonthKey();
  const currentMonthData = chartData.find((m) => m.month === currentMonth);

  const handleClick = (data) => {
    if (data && data.activePayload && data.activePayload[0]) {
      onMonthSelect(data.activePayload[0].payload.month);
    }
  };

  const tickInterval =
    chartMonthCount <= 12 ? 0 : chartMonthCount <= 24 ? 1 : chartMonthCount <= 36 ? 2 : 3;

  return (
    <div className="chart-container" data-testid="chart-projection">
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
              {horizon}-Month forward
            </h2>
            <p className="text-[11px] text-zinc-600 mt-0.5">
              Chart: {chartMonthCount} of {monthCount} months
              {pastSpan === 'all' ? ' (full history)' : ` (now + ${pastSpan} mo past)`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label htmlFor="chart-history-span" className="text-[10px] uppercase tracking-wider text-zinc-500 whitespace-nowrap">
              Past on chart
            </label>
            <select
              id="chart-history-span"
              value={pastSpan === 'all' ? 'all' : String(pastSpan)}
              onChange={(e) => {
                const v = e.target.value;
                setPastSpan(v === 'all' ? 'all' : Number(v));
              }}
              className="bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-300 py-1 px-2 font-mono focus:outline-none focus:ring-1 focus:ring-zinc-500"
              data-testid="chart-history-span"
            >
              <option value="2">2 months</option>
              <option value="6">6 months</option>
              <option value="12">12 months</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span>Safe</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"></span>Watch</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500"></span>Danger</span>
        </div>
      </div>
      
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 15, right: 25, left: 15, bottom: 5 }} onClick={handleClick}>
            {yMin < 0 && <ReferenceArea y1={yMin} y2={0} fill="#fb7185" fillOpacity={0.1} />}
            <ReferenceArea y1={Math.max(0, yMin)} y2={safety_buffer} fill="#fbbf24" fillOpacity={0.08} />
            <ReferenceArea y1={safety_buffer} y2={yMax} fill="#34d399" fillOpacity={0.08} />
            
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            
            <XAxis 
              dataKey="month_label" 
              stroke="#52525b"
              tick={{ fill: '#71717a', fontSize: 9, fontFamily: 'IBM Plex Mono' }}
              tickLine={{ stroke: '#3f3f46' }}
              axisLine={{ stroke: '#3f3f46' }}
              interval={tickInterval}
            />
            
            <YAxis 
              stroke="#52525b"
              tick={{ fill: '#71717a', fontSize: 9, fontFamily: 'IBM Plex Mono' }}
              tickLine={{ stroke: '#3f3f46' }}
              axisLine={{ stroke: '#3f3f46' }}
              tickFormatter={formatCurrency}
              domain={[yMin, yMax]}
              width={45}
            />
            
            <Tooltip content={<CustomTooltip />} />
            
            <ReferenceLine y={safety_buffer} stroke="#34d399" strokeDasharray="5 5" strokeOpacity={0.5} />
            {yMin < 0 && <ReferenceLine y={0} stroke="#fb7185" strokeDasharray="5 5" strokeOpacity={0.5} />}
            
            {currentMonthData && (
              <ReferenceLine 
                x={currentMonthData.month_label}
                stroke="#fafafa" 
                strokeDasharray="3 3"
                strokeOpacity={0.5}
              />
            )}
            
            <Line 
              type="monotone" 
              dataKey="closing_cash" 
              stroke="#fafafa" 
              strokeWidth={2.5}
              dot={{ fill: '#fafafa', strokeWidth: 0, r: chartMonthCount > 18 ? 1 : 3 }}
              activeDot={{ fill: '#fafafa', stroke: '#18181b', strokeWidth: 2, r: 5 }}
              connectNulls={true}
            />
            
            {firstDangerInChart && (
              <ReferenceDot x={firstDangerInChart.month_label} y={firstDangerInChart.closing_cash} r={6} fill="#fb7185" stroke="#18181b" strokeWidth={2} />
            )}
            
            {firstWatchInChart && !firstDangerInChart && (
              <ReferenceDot x={firstWatchInChart.month_label} y={firstWatchInChart.closing_cash} r={5} fill="#fbbf24" stroke="#18181b" strokeWidth={2} />
            )}
            
            {lowestInChart && (!firstDangerInChart || lowestInChart.month !== firstDangerInChart.month) && (
              <ReferenceDot
                x={lowestInChart.month_label}
                y={lowestInChart.closing_cash}
                r={5}
                fill={lowestInChart.closing_cash < 0 ? '#fb7185' : '#fbbf24'}
                stroke="#18181b"
                strokeWidth={2}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      
      {/* Key callouts — KPIs stay full-horizon; chart above is zoomed */}
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {first_danger_month && (
          <div className="px-2 py-1 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 font-medium">
            Goes negative: {first_danger_month}
          </div>
        )}
        {first_watch_month && !first_danger_month && (
          <div className="px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400">
            Breach: {first_watch_month}
          </div>
        )}
        <div className="px-2 py-1 rounded bg-zinc-800/50 text-zinc-400">
          Low: {formatFullCurrency(lowest_cash)} ({lowest_cash_month})
        </div>
      </div>
    </div>
  );
};
