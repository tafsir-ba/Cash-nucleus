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

const StatusBadge = ({ status }) => {
  const config = {
    Good: {
      icon: CheckCircle,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
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

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded ${bg}`}>
      <Icon size={14} weight="fill" className={color} />
      <span className={`text-xs font-medium ${color}`}>{status}</span>
    </span>
  );
};

export const MonthlyTable = ({ months, selectedMonth, onMonthSelect }) => {
  if (!months || months.length === 0) {
    return (
      <div className="surface-card p-6">
        <p className="text-zinc-500 text-sm">No projection data available</p>
      </div>
    );
  }

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
            {months.map((month, index) => (
              <tr 
                key={month.month}
                onClick={() => onMonthSelect(month.month)}
                className={`animate-fade-in stagger-${index + 1} ${
                  selectedMonth === month.month ? 'selected' : ''
                }`}
                data-testid={`month-row-${month.month}`}
              >
                <td className="font-medium text-zinc-100">{month.month_label}</td>
                <td className="text-right text-emerald-400">
                  {month.inflows > 0 ? `+${formatCurrency(month.inflows)}` : '-'}
                </td>
                <td className="text-right text-rose-400">
                  {month.outflows > 0 ? `-${formatCurrency(month.outflows)}` : '-'}
                </td>
                <td className={`text-right ${month.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {month.net >= 0 ? '+' : ''}{formatCurrency(month.net)}
                </td>
                <td className={`text-right font-medium ${month.closing_cash < 0 ? 'text-rose-400' : 'text-zinc-100'}`}>
                  {formatCurrency(month.closing_cash)}
                </td>
                <td className="text-center">
                  <StatusBadge status={month.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
};
