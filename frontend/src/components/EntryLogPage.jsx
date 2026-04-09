import { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { toast } from "sonner";
import { 
  PencilSimple, Trash, ArrowsClockwise, Link as LinkIcon, MagnifyingGlass
} from "@phosphor-icons/react";
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from "../components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "../components/ui/dialog";
import { FlowEditor } from "./FlowEditor";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('de-CH', {
    style: 'currency', currency: 'CHF',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amount);
};

const categories = ["Revenue", "Salary", "Tax", "Debt", "Expense", "COGS", "Transfer", "Other"];

export const EntryLogPage = ({ entities, onDataChange }) => {
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [editingFlow, setEditingFlow] = useState(null);
  const [deletingFlow, setDeletingFlow] = useState(null);

  const fetchFlows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/cash-flows/with-linked`);
      setFlows(res.data);
    } catch (err) {
      console.error("Failed to fetch:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFlows(); }, [fetchFlows]);

  const filteredFlows = useMemo(() => {
    return flows.filter(group => {
      const f = group.flow;
      if (!f) return false;
      const matchSearch = !searchQuery || 
        f.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.category.toLowerCase().includes(searchQuery.toLowerCase());
      const matchCategory = filterCategory === "all" || f.category === filterCategory;
      const matchType = filterType === "all" || 
        (filterType === "inflow" && f.amount > 0) ||
        (filterType === "outflow" && f.amount <= 0);
      return matchSearch && matchCategory && matchType;
    });
  }, [flows, searchQuery, filterCategory, filterType]);

  const handleDelete = async (flow, deleteLinked = false) => {
    try {
      await axios.delete(`${API}/cash-flows/${flow.id}?delete_linked=${deleteLinked}`);
      toast.success("Deleted");
      setDeletingFlow(null);
      fetchFlows();
      onDataChange?.();
    } catch (err) {
      toast.error("Delete failed");
    }
  };

  const handleSaved = () => {
    fetchFlows();
    onDataChange?.();
  };

  const entityMap = {};
  entities.forEach(e => { entityMap[e.id] = e.name; });

  return (
    <div className="surface-card" data-testid="entry-log-page">
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
            Entry Log
          </h2>
          <span className="text-xs text-zinc-600">{filteredFlows.length} entries</span>
        </div>
        
        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Search flows..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md pl-8 pr-3 py-2 text-zinc-100 placeholder-zinc-600"
              data-testid="entry-search"
            />
          </div>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-[120px] bg-zinc-950 border-zinc-800 text-sm h-[38px]" data-testid="filter-category">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[100px] bg-zinc-950 border-zinc-800 text-sm h-[38px]" data-testid="filter-type">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="inflow">Inflows</SelectItem>
              <SelectItem value="outflow">Outflows</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Flow List */}
      <div className="divide-y divide-zinc-800/50">
        {filteredFlows.length === 0 && (
          <div className="p-8 text-center text-zinc-600 text-sm">No entries found</div>
        )}
        {filteredFlows.map((group) => {
          const flow = group.flow;
          const linked = group.linked_flows || [];
          return (
          <div key={flow.id} className="group" data-testid={`entry-${flow.id}`}>
            <div className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/20 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-200 truncate">{flow.label}</span>
                  {(flow.recurrence === "monthly" || flow.recurrence === "quarterly") && (
                    <ArrowsClockwise size={12} className="text-amber-400 flex-shrink-0" />
                  )}
                  {flow.recurrence_mode === "distribute" && (
                    <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1 py-0.5 rounded">Dist</span>
                  )}
                  {linked.length > 0 && (
                    <LinkIcon size={12} className="text-amber-400 flex-shrink-0" />
                  )}
                  {flow.priority && (
                    <span className={`text-[10px] px-1 py-0.5 rounded ${
                      flow.priority === 'critical' ? 'bg-rose-500/20 text-rose-400' :
                      flow.priority === 'flexible' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-cyan-500/20 text-cyan-400'
                    }`} data-testid={`priority-${flow.id}`}>{flow.priority}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-zinc-500">{flow.category}</span>
                  <span className="text-xs text-zinc-700">·</span>
                  <span className="text-xs text-zinc-500">{entityMap[flow.entity_id] || 'Unknown'}</span>
                  <span className="text-xs text-zinc-700">·</span>
                  <span className="text-xs text-zinc-500">
                    {new Date(flow.date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                  </span>
                  {flow.recurrence !== "none" && flow.recurrence_count && (
                    <>
                      <span className="text-xs text-zinc-700">·</span>
                      <span className="text-xs text-zinc-500">{flow.recurrence_count}x {flow.recurrence}</span>
                    </>
                  )}
                </div>
              </div>
              <span className={`font-mono text-sm font-medium ${flow.amount > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {flow.amount > 0 ? '+' : ''}{formatCurrency(flow.amount)}
              </span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => setEditingFlow(flow)}
                  className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded"
                  data-testid={`edit-${flow.id}`}>
                  <PencilSimple size={14} />
                </button>
                <button onClick={() => setDeletingFlow({ flow, hasLinked: linked.length > 0 })}
                  className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded"
                  data-testid={`delete-${flow.id}`}>
                  <Trash size={14} />
                </button>
              </div>
            </div>
            {linked.map(child => (
              <div key={child.id} className="flex items-center gap-3 px-4 py-2 pl-10 bg-zinc-900/30 hover:bg-zinc-800/20 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-600 text-xs">└</span>
                    <span className="text-xs text-zinc-400">{child.label}</span>
                    {child.is_percentage && (
                      <span className="text-[10px] text-amber-500/60">{child.percentage_of_parent}%</span>
                    )}
                  </div>
                </div>
                <span className={`font-mono text-xs ${child.amount > 0 ? 'text-emerald-400/70' : 'text-rose-400/70'}`}>
                  {child.amount > 0 ? '+' : ''}{formatCurrency(child.amount)}
                </span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setEditingFlow(child)}
                    className="p-1 text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 rounded">
                    <PencilSimple size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          );
        })}
      </div>

      {/* Canonical Flow Editor */}
      <FlowEditor
        flow={editingFlow}
        open={!!editingFlow}
        onOpenChange={(open) => !open && setEditingFlow(null)}
        entities={entities}
        onSave={handleSaved}
      />

      {/* Delete Confirmation */}
      <Dialog open={!!deletingFlow} onOpenChange={(open) => !open && setDeletingFlow(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800 max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-zinc-100 font-heading">Delete Entry</DialogTitle>
            <DialogDescription className="text-zinc-500">Use undo to reverse this action.</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-zinc-300">{deletingFlow?.flow?.label}</p>
          <div className="flex flex-col gap-2 mt-2">
            {deletingFlow?.hasLinked && (
              <button onClick={() => handleDelete(deletingFlow.flow, true)}
                className="btn-secondary text-sm text-rose-400 border-rose-500/20">
                Delete with linked flows
              </button>
            )}
            <button onClick={() => handleDelete(deletingFlow?.flow, false)}
              className="btn-secondary text-sm">
              {deletingFlow?.hasLinked ? 'Delete only this flow' : 'Delete'}
            </button>
            <button onClick={() => setDeletingFlow(null)} className="btn-secondary text-sm text-zinc-500">
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
