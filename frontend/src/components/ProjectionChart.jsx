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
} from 'recharts';

const formatCurrency = (amount) => {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(1)}M`;
  }
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(0)}K`;
  }
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

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 shadow-xl">
        <p className="text-zinc-400 text-xs font-medium mb-2">{data.month_label}</p>
        <div className="space-y-1">
          <p className="text-zinc-100 text-sm font-mono">
            Cash: {formatFullCurrency(data.closing_cash)}
          </p>
          <p className="text-emerald-400 text-xs font-mono">
            In: +{formatFullCurrency(data.inflows)}
          </p>
          <p className="text-rose-400 text-xs font-mono">
            Out: -{formatFullCurrency(data.outflows)}
          </p>
          <p className="text-zinc-300 text-xs font-mono">
            Net: {data.net >= 0 ? '+' : ''}{formatFullCurrency(data.net)}
          </p>
        </div>
      </div>
    );
  }
  return null;
};

export const ProjectionChart = ({ projection, selectedMonth, onMonthSelect }) => {
  if (!projection) return null;

  const { months, safety_buffer } = projection;
  
  // Calculate min and max for y-axis
  const allValues = months.map(m => m.closing_cash);
  const minValue = Math.min(...allValues, 0);
  const maxValue = Math.max(...allValues, safety_buffer);
  const padding = (maxValue - minValue) * 0.1;
  const yMin = Math.floor((minValue - padding) / 10000) * 10000;
  const yMax = Math.ceil((maxValue + padding) / 10000) * 10000;

  // Current month for reference line
  const currentMonth = new Date().toISOString().slice(0, 7);

  const handleClick = (data) => {
    if (data && data.activePayload && data.activePayload[0]) {
      onMonthSelect(data.activePayload[0].payload.month);
    }
  };

  return (
    <div className="chart-container" data-testid="chart-projection">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
          12-Month Projection
        </h2>
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-emerald-500/20 border border-emerald-500/40"></span>
            Safe
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-amber-500/20 border border-amber-500/40"></span>
            Watch
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-rose-500/20 border border-rose-500/40"></span>
            Danger
          </span>
        </div>
      </div>
      
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart 
            data={months} 
            margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
            onClick={handleClick}
          >
            {/* Danger Zone (below 0) */}
            <ReferenceArea
              y1={yMin}
              y2={0}
              fill="#fb7185"
              fillOpacity={0.1}
            />
            {/* Watch Zone (0 to buffer) */}
            <ReferenceArea
              y1={0}
              y2={safety_buffer}
              fill="#fbbf24"
              fillOpacity={0.1}
            />
            {/* Safe Zone (above buffer) */}
            <ReferenceArea
              y1={safety_buffer}
              y2={yMax}
              fill="#34d399"
              fillOpacity={0.1}
            />
            
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke="#27272a" 
              vertical={false}
            />
            
            <XAxis 
              dataKey="month_label" 
              stroke="#52525b"
              tick={{ fill: '#71717a', fontSize: 11, fontFamily: 'IBM Plex Mono' }}
              tickLine={{ stroke: '#3f3f46' }}
              axisLine={{ stroke: '#3f3f46' }}
            />
            
            <YAxis 
              stroke="#52525b"
              tick={{ fill: '#71717a', fontSize: 11, fontFamily: 'IBM Plex Mono' }}
              tickLine={{ stroke: '#3f3f46' }}
              axisLine={{ stroke: '#3f3f46' }}
              tickFormatter={formatCurrency}
              domain={[yMin, yMax]}
            />
            
            <Tooltip content={<CustomTooltip />} />
            
            {/* Safety buffer line */}
            <ReferenceLine 
              y={safety_buffer} 
              stroke="#34d399" 
              strokeDasharray="5 5"
              strokeOpacity={0.5}
            />
            
            {/* Zero line */}
            <ReferenceLine 
              y={0} 
              stroke="#fb7185" 
              strokeDasharray="5 5"
              strokeOpacity={0.5}
            />
            
            {/* Current month marker */}
            {months.find(m => m.month === currentMonth) && (
              <ReferenceLine 
                x={months.find(m => m.month === currentMonth)?.month_label}
                stroke="#a1a1aa" 
                strokeDasharray="3 3"
                label={{ 
                  value: 'Now', 
                  position: 'top', 
                  fill: '#71717a',
                  fontSize: 10,
                  fontFamily: 'Manrope'
                }}
              />
            )}
            
            <Line 
              type="monotone" 
              dataKey="closing_cash" 
              stroke="#fafafa" 
              strokeWidth={2}
              dot={{ fill: '#fafafa', strokeWidth: 0, r: 3 }}
              activeDot={{ fill: '#fafafa', stroke: '#18181b', strokeWidth: 2, r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
