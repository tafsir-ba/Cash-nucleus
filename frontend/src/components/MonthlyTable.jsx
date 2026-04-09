import { CheckCircle, WarningCircle, Eye } from "@phosphor-icons/react";
import { ScrollArea } from "../components/ui/scroll-area";

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency: 'CHF',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const StatusBadge = ({ status, isFirst }) => {
  // Only show colored badge for first occurrence of Watch or Danger
  if (!isFirst && (status === 'Watch' || status === 'Danger')) {
    return <span className="text-xs text-zinc-600">{status}</span>;
  }
  
  const config = {
    Good: {
      icon: CheckCircle,
      color: 'text-zinc-500',
      bg: 'bg-transparent',
    },
    Watch: {
      icon: Eye,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
    },
    Danger: {
      icon: WarningCircle,
      color: 'text-rose-400',
      bg: 'bg-rose-500/10',
    },
  };

  const { icon: Icon, color, bg } = config[status] || config.Good;

  // Good status - minimal display
  if (status === 'Good') {
    return <span className="text-xs text-zinc-600">—</span>;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded ${bg}`}>
      <Icon size={14} weight="fill" className={color} />
      <span className={`text-xs font-medium ${color}`}>{status}</span>
    </span>
  );
};

export const MonthlyTable = ({ months, selectedMonth, onMonthSelect, hasData }) => {
  // Empty state
  if (!months || months.length === 0 || !hasData) {
    return (
      <div className="surface-card p-6">
        <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading mb-4">
          Monthly Breakdown
        </h2>
        <p className="text-zinc-600 text-sm text-center py-8">
          Add cash flows to see monthly breakdown
        </p>
      </div>
    );
  }

  // Track first Watch and Danger
  let firstWatch = null;
  let firstDanger = null;
  
  months.forEach((month, index) => {
    if (month.status === 'Watch' && firstWatch === null) {
      firstWatch = index;
    }
    if (month.status === 'Danger' && firstDanger === null) {
      firstDanger = index;
    }
  });

  return (
    <div className="surface-card" data-testid="table-monthly">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
          Monthly Breakdown
        </h2>
      </div>
      
      <ScrollArea className="h-[400px]">
        <table className="data-table">
          <thead className="sticky top-0 bg-zinc-900/95 backdrop-blur-sm">
            <tr>
              <th>Month</th>
              <th className="text-right">Inflows</th>
              <th className="text-right">Outflows</th>
              <th className="text-right">Net</th>
              <th className="text-right">Closing</th>
              <th className="text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {months.map((month, index) => {
              const isFirstWatch = index === firstWatch;
              const isFirstDanger = index === firstDanger;
              const isFirst = isFirstWatch || isFirstDanger;
              
              return (
                <tr 
                  key={month.month}
                  onClick={() => onMonthSelect(month.month)}
                  className={`animate-fade-in stagger-${index + 1} ${
                    selectedMonth === month.month ? 'selected' : ''
                  } ${isFirst ? 'border-l-2 border-l-amber-500' : ''}`}
                  data-testid={`month-row-${month.month}`}
                >
                  <td className="font-medium text-zinc-100">{month.month_label}</td>
                  <td className="text-right text-emerald-400">
                    {month.inflows > 0 ? `+${formatCurrency(month.inflows)}` : '—'}
                  </td>
                  <td className="text-right text-rose-400">
                    {month.outflows > 0 ? `-${formatCurrency(month.outflows)}` : '—'}
                  </td>
                  <td className={`text-right ${month.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {month.net !== 0 ? (month.net >= 0 ? '+' : '') + formatCurrency(month.net) : '—'}
                  </td>
                  <td className={`text-right font-medium ${month.closing_cash < 0 ? 'text-rose-400' : 'text-zinc-100'}`}>
                    {formatCurrency(month.closing_cash)}
                  </td>
                  <td className="text-center">
                    <StatusBadge status={month.status} isFirst={isFirst} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
};
