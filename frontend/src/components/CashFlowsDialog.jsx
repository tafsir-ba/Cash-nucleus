import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Trash, PencilSimple, ArrowsClockwise } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { ScrollArea } from "../components/ui/scroll-area";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency: 'CHF',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));
};

const formatDate = (dateStr) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB', { 
    day: '2-digit', 
    month: 'short', 
    year: 'numeric' 
  });
};

const CertaintyBadge = ({ certainty }) => {
  const colors = {
    "Materialized": "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    "Sure to happen": "bg-blue-500/20 text-blue-400 border-blue-500/30",
    "50/50": "bg-amber-500/20 text-amber-400 border-amber-500/30",
    "Idea": "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  };
  
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${colors[certainty] || colors["Idea"]}`}>
      {certainty === "Sure to happen" ? "Sure" : certainty}
    </span>
  );
};

export const CashFlowsDialog = ({ open, onOpenChange, onDataChange }) => {
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all"); // all, inflows, outflows

  const fetchFlows = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/cash-flows`);
      // Sort by date descending
      const sorted = response.data.sort((a, b) => 
        new Date(b.date) - new Date(a.date)
      );
      setFlows(sorted);
    } catch (error) {
      console.error("Failed to fetch flows:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchFlows();
    }
  }, [open]);

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this cash flow?")) return;

    try {
      await axios.delete(`${API}/cash-flows/${id}`);
      toast.success("Cash flow deleted");
      fetchFlows();
      onDataChange?.();
    } catch (error) {
      console.error("Failed to delete flow:", error);
      toast.error("Failed to delete cash flow");
    }
  };

  const filteredFlows = flows.filter(flow => {
    if (filter === "inflows") return flow.amount > 0;
    if (filter === "outflows") return flow.amount < 0;
    return true;
  });

  const totalInflows = flows.filter(f => f.amount > 0).reduce((sum, f) => sum + f.amount, 0);
  const totalOutflows = flows.filter(f => f.amount < 0).reduce((sum, f) => sum + Math.abs(f.amount), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-2xl" data-testid="cash-flows-dialog">
        <DialogHeader>
          <DialogTitle className="text-zinc-100 font-heading">Cash Flows</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3">
              <p className="text-xs text-zinc-500 mb-1">Total Flows</p>
              <p className="text-lg font-mono text-zinc-100">{flows.length}</p>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-md p-3">
              <p className="text-xs text-emerald-400 mb-1">Total Inflows</p>
              <p className="text-lg font-mono text-emerald-400">+{formatCurrency(totalInflows)}</p>
            </div>
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-md p-3">
              <p className="text-xs text-rose-400 mb-1">Total Outflows</p>
              <p className="text-lg font-mono text-rose-400">-{formatCurrency(totalOutflows)}</p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-2">
            {["all", "inflows", "outflows"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                  filter === f 
                    ? 'bg-zinc-800 text-zinc-100' 
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {/* Flow list */}
          <ScrollArea className="h-[400px]">
            {loading ? (
              <div className="text-center py-8 text-zinc-500">Loading...</div>
            ) : filteredFlows.length === 0 ? (
              <div className="text-center py-8 text-zinc-600">
                No cash flows found
              </div>
            ) : (
              <div className="space-y-2 pr-4">
                {filteredFlows.map((flow) => (
                  <div 
                    key={flow.id}
                    className="flex items-center justify-between p-3 bg-zinc-950 border border-zinc-800 rounded-md hover:bg-zinc-900/50 transition-colors"
                    data-testid={`flow-item-${flow.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm text-zinc-200 truncate">{flow.label}</p>
                        {flow.recurrence === "monthly" && (
                          <ArrowsClockwise size={14} className="text-amber-400 flex-shrink-0" title="Recurring" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        <span>{formatDate(flow.date)}</span>
                        <span>·</span>
                        <span>{flow.category}</span>
                        {flow.entity && (
                          <>
                            <span>·</span>
                            <span>{flow.entity}</span>
                          </>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3 ml-4">
                      <CertaintyBadge certainty={flow.certainty} />
                      <span className={`text-sm font-mono ${flow.amount < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {flow.amount < 0 ? '-' : '+'}{formatCurrency(flow.amount)}
                      </span>
                      <button
                        onClick={() => handleDelete(flow.id)}
                        className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 rounded transition-colors"
                        data-testid={`delete-flow-${flow.id}`}
                      >
                        <Trash size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
};
