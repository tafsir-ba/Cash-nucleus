import { TrendDown, ArrowsClockwise, Lightning } from "@phosphor-icons/react";

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency: 'CHF',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));
};

export const PressurePanel = ({ monthDetails, selectedMonth }) => {
  if (!selectedMonth || !monthDetails) {
    return (
      <div className="pressure-panel h-full flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
            Pressure Analysis
          </h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-zinc-600 text-sm text-center">
            Select a month from the chart or table to see detailed pressure analysis
          </p>
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

  return (
    <div className="pressure-panel h-full" data-testid="pressure-panel">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
          {selectedMonth} Analysis
        </h2>
      </div>
      
      <div className="p-4 space-y-6 overflow-y-auto max-h-[360px]">
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

        {/* Top Outflows */}
        {top_outflows && top_outflows.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <TrendDown size={16} className="text-rose-400" />
              <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Top Outflows
              </h3>
            </div>
            <div className="space-y-2">
              {top_outflows.slice(0, 3).map((flow, index) => (
                <div 
                  key={index}
                  className="flex items-center justify-between py-2 px-3 bg-zinc-900/50 rounded-md border border-zinc-800/50"
                >
                  <div>
                    <p className="text-sm text-zinc-200">{flow.label}</p>
                    <p className="text-xs text-zinc-500">{flow.category}</p>
                  </div>
                  <p className="text-sm font-mono text-rose-400">
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
                Recurring Burdens
              </h3>
            </div>
            <div className="space-y-2">
              {recurring_burdens.map((flow, index) => (
                <div 
                  key={index}
                  className="flex items-center justify-between py-2 px-3 bg-zinc-900/50 rounded-md border border-zinc-800/50"
                >
                  <div>
                    <p className="text-sm text-zinc-200">{flow.label}</p>
                    <p className="text-xs text-zinc-500">{flow.category}</p>
                  </div>
                  <p className={`text-sm font-mono ${flow.amount < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {flow.amount < 0 ? '-' : '+'}{formatCurrency(flow.amount)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {(!top_outflows || top_outflows.length === 0) && 
         (!recurring_burdens || recurring_burdens.length === 0) && (
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <Lightning size={32} className="text-zinc-700 mx-auto mb-2" />
              <p className="text-zinc-600 text-sm">No cash flows in this month</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
