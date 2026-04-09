import { TrendUp, TrendDown, Equals } from "@phosphor-icons/react";

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency: 'CHF',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));
};

export const MonthlyPLPanel = ({ monthDetails, selectedMonth }) => {
  if (!selectedMonth || !monthDetails) {
    return (
      <div className="surface-card h-full flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
            Monthly P&L
          </h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-zinc-600 text-sm text-center">
            Select a month to see P&L summary
          </p>
        </div>
      </div>
    );
  }

  const { all_flows } = monthDetails;
  
  // Calculate totals
  const revenues = all_flows
    .filter(f => f.amount > 0)
    .reduce((sum, f) => sum + f.amount, 0);
  
  const costs = all_flows
    .filter(f => f.amount < 0)
    .reduce((sum, f) => sum + Math.abs(f.amount), 0);
  
  const netResult = revenues - costs;

  // Format month for display
  const [year, month] = selectedMonth.split('-');
  const monthLabel = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-GB', { 
    month: 'long', 
    year: 'numeric' 
  });

  return (
    <div className="surface-card h-full" data-testid="pl-panel">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
          {monthLabel} — P&L
        </h2>
      </div>
      
      <div className="p-4">
        {/* Revenues vs Costs */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* Revenues */}
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendUp size={16} weight="bold" className="text-emerald-400" />
              <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">Revenues</span>
            </div>
            <p className="text-2xl font-mono text-emerald-400 font-medium">
              +{formatCurrency(revenues)}
            </p>
          </div>

          {/* Costs */}
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendDown size={16} weight="bold" className="text-rose-400" />
              <span className="text-xs font-medium text-rose-400 uppercase tracking-wider">Costs</span>
            </div>
            <p className="text-2xl font-mono text-rose-400 font-medium">
              -{formatCurrency(costs)}
            </p>
          </div>
        </div>

        {/* Net Result */}
        <div className={`rounded-lg p-4 ${
          netResult >= 0 
            ? 'bg-emerald-500/5 border border-emerald-500/30' 
            : 'bg-rose-500/5 border border-rose-500/30'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Equals size={16} weight="bold" className={netResult >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
              <span className={`text-xs font-medium uppercase tracking-wider ${
                netResult >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                Net {netResult >= 0 ? 'Profit' : 'Loss'}
              </span>
            </div>
            <p className={`text-3xl font-mono font-semibold ${
              netResult >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              {netResult >= 0 ? '+' : '-'}{formatCurrency(netResult)}
            </p>
          </div>
        </div>

        {/* Flow count */}
        <p className="text-xs text-zinc-600 mt-3 text-center">
          {all_flows.length} flow{all_flows.length !== 1 ? 's' : ''} this month
        </p>
      </div>
    </div>
  );
};
