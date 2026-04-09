import { TrendDown, ArrowsClockwise, Crosshair } from "@phosphor-icons/react";

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency: 'CHF',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));
};

export const PressurePanel = ({ monthDetails, selectedMonth }) => {
  // Empty state - no month selected
  if (!selectedMonth || !monthDetails) {
    return (
      <div className="pressure-panel h-full flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
            Month Analysis
          </h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <Crosshair size={32} className="text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">
              Select a month to see main cash drivers
            </p>
            <p className="text-zinc-600 text-xs mt-1">
              Click on chart or table row
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { top_outflows, recurring_burdens, all_flows } = monthDetails;
  const totalOutflows = all_flows
    .filter(f => f.amount < 0)
    .reduce((sum, f) => sum + Math.abs(f.amount), 0);
  const totalInflows = all_flows
    .filter(f => f.amount > 0)
    .reduce((sum, f) => sum + f.amount, 0);

  // Format month for display
  const [year, month] = selectedMonth.split('-');
  const monthLabel = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-GB', { 
    month: 'long', 
    year: 'numeric' 
  });

  return (
    <div className="pressure-panel h-full" data-testid="pressure-panel">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
          {monthLabel}
        </h2>
      </div>
      
      <div className="p-4 space-y-5 overflow-y-auto max-h-[360px]">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-md p-3">
            <p className="text-xs text-emerald-400 mb-1">Total In</p>
            <p className="text-lg font-mono text-emerald-400">+{formatCurrency(totalInflows)}</p>
          </div>
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-md p-3">
            <p className="text-xs text-rose-400 mb-1">Total Out</p>
            <p className="text-lg font-mono text-rose-400">-{formatCurrency(totalOutflows)}</p>
          </div>
        </div>

        {/* Top Outflows - THE KEY INFO */}
        {top_outflows && top_outflows.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <TrendDown size={16} className="text-rose-400" />
              <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Top 3 Outflows
              </h3>
            </div>
            <div className="space-y-2">
              {top_outflows.slice(0, 3).map((flow, index) => (
                <div 
                  key={index}
                  className="flex items-center justify-between py-2 px-3 bg-zinc-900/50 rounded-md border border-zinc-800/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-200 truncate">{flow.label}</p>
                    <p className="text-xs text-zinc-500">{flow.category}</p>
                  </div>
                  <p className="text-sm font-mono text-rose-400 ml-3">
                    -{formatCurrency(flow.amount)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recurring Burdens */}
        {recurring_burdens && recurring_burdens.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <ArrowsClockwise size={16} className="text-amber-400" />
              <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Recurring Costs
              </h3>
            </div>
            <div className="space-y-2">
              {recurring_burdens.slice(0, 3).map((flow, index) => (
                <div 
                  key={index}
                  className="flex items-center justify-between py-2 px-3 bg-zinc-900/50 rounded-md border border-zinc-800/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-200 truncate">{flow.label}</p>
                    <p className="text-xs text-zinc-500">{flow.category}</p>
                  </div>
                  <p className={`text-sm font-mono ml-3 ${flow.amount < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {flow.amount < 0 ? '-' : '+'}{formatCurrency(flow.amount)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty month state */}
        {(!top_outflows || top_outflows.length === 0) && 
         (!recurring_burdens || recurring_burdens.length === 0) && (
          <div className="flex items-center justify-center py-6">
            <p className="text-zinc-600 text-sm">No cash flows in this month</p>
          </div>
        )}
      </div>
    </div>
  );
};
