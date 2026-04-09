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
  if (!projection || !hasData) {
    return (
      <div className="chart-container h-[340px] flex flex-col items-center justify-center" data-testid="chart-projection">
        <p className="text-zinc-500 text-sm mb-2">Add cash or flows to see projection</p>
        <p className="text-zinc-600 text-xs">Your forecast will appear here</p>
      </div>
    );
  }

  const { months, safety_buffer, lowest_cash, lowest_cash_month, first_watch_month, first_danger_month } = projection;
  
  const lowestMonth = months.find(m => m.closing_cash === lowest_cash);
  const firstWatchData = months.find(m => m.month_label === first_watch_month);
  const firstDangerData = months.find(m => m.month_label === first_danger_month);
  
  // Auto-scale Y-axis
  const allValues = months.map(m => m.closing_cash);
  const minValue = Math.min(...allValues, 0);
  const maxValue = Math.max(...allValues, safety_buffer);
  const range = maxValue - minValue;
  const padding = Math.max(range * 0.15, 5000);
  const yMin = Math.floor((minValue - padding) / 5000) * 5000;
  const yMax = Math.ceil((maxValue + padding) / 5000) * 5000;

  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentMonthData = months.find(m => m.month === currentMonth);

  const handleClick = (data) => {
    if (data && data.activePayload && data.activePayload[0]) {
      onMonthSelect(data.activePayload[0].payload.month);
    }
  };

  // Adjust tick interval for longer horizons
  const tickInterval = horizon <= 12 ? 0 : horizon <= 24 ? 1 : 2;

  return (
    <div className="chart-container" data-testid="chart-projection">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
          {horizon}-Month Projection
        </h2>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span>Safe</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"></span>Watch</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500"></span>Danger</span>
        </div>
      </div>
      
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={months} margin={{ top: 15, right: 25, left: 15, bottom: 5 }} onClick={handleClick}>
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
              strokeWidth={2}
              dot={{ fill: '#fafafa', strokeWidth: 0, r: horizon > 12 ? 1 : 2 }}
              activeDot={{ fill: '#fafafa', stroke: '#18181b', strokeWidth: 2, r: 5 }}
            />
            
            {firstDangerData && (
              <ReferenceDot x={firstDangerData.month_label} y={firstDangerData.closing_cash} r={6} fill="#fb7185" stroke="#18181b" strokeWidth={2} />
            )}
            
            {firstWatchData && !firstDangerData && (
              <ReferenceDot x={firstWatchData.month_label} y={firstWatchData.closing_cash} r={5} fill="#fbbf24" stroke="#18181b" strokeWidth={2} />
            )}
            
            {lowestMonth && lowestMonth.month_label !== first_danger_month && (
              <ReferenceDot
                x={lowestMonth.month_label}
                y={lowestMonth.closing_cash}
                r={5}
                fill={lowest_cash < 0 ? '#fb7185' : '#fbbf24'}
                stroke="#18181b"
                strokeWidth={2}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      
      {/* Key callouts */}
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
