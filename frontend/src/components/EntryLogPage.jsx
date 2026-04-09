import { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { toast } from "sonner";
import { 
  PencilSimple, Trash, ArrowsClockwise, Link as LinkIcon, 
  MagnifyingGlass, Funnel, CaretDown, Check, X
} from "@phosphor-icons/react";
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from "../components/ui/select";
import { Label } from "../components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "../components/ui/dialog";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('de-CH', {
    style: 'currency', currency: 'CHF',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amount);
};

const categories = ["Revenue", "Salary", "Tax", "Debt", "Expense", "COGS", "Transfer", "Other"];

const EditFlowDialog = ({ flow, open, onOpenChange, onSave, entities }) => {
  const [formData, setFormData] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (flow) {
      setFormData({
        label: flow.label || "",
        amount: flow.amount?.toString() || "",
        date: flow.date?.substring(0, 7) || "",
        category: flow.category || "Expense",
        certainty: flow.certainty || "Materialized",
        recurrence: flow.recurrence || "none",
        recurrence_mode: flow.recurrence_mode || "repeat",
        recurrence_count: flow.recurrence_count?.toString() || "",
        entity_id: flow.entity_id || "",
      });
    }
  }, [flow]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/cash-flows/${flow.id}`, {
        label: formData.label,
        amount: parseFloat(formData.amount),
        date: `${formData.date}-01`,
        category: formData.category,
        certainty: formData.certainty,
        recurrence: formData.recurrence,
        recurrence_mode: formData.recurrence !== "none" ? formData.recurrence_mode : "repeat",
        recurrence_count: formData.recurrence !== "none" && formData.recurrence_count
          ? parseInt(formData.recurrence_count) : null,
        entity_id: formData.entity_id,
      });
      toast.success("Updated");
      onSave?.();
      onOpenChange(false);
    } catch (err) {
      toast.error("Update failed");
    } finally {
      setSaving(false);
    }
  };

  if (!flow) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-zinc-100 font-heading">Edit Flow</DialogTitle>
          <DialogDescription className="text-zinc-500">Modify flow details</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-zinc-500 mb-1 block">Label</Label>
            <input value={formData.label || ""} onChange={(e) => setFormData({ ...formData, label: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-zinc-500 mb-1 block">Amount</Label>
              <input type="number" step="0.01" value={formData.amount || ""} 
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 font-mono" />
            </div>
            <div>
              <Label className="text-xs text-zinc-500 mb-1 block">Month</Label>
              <input type="month" value={formData.date || ""} 
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-zinc-500 mb-1 block">Category</Label>
              <Select value={formData.category || "Expense"} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                <SelectTrigger className="bg-zinc-950 border-zinc-800 h-[38px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-zinc-500 mb-1 block">Entity</Label>
              <Select value={formData.entity_id || ""} onValueChange={(v) => setFormData({ ...formData, entity_id: v })}>
                <SelectTrigger className="bg-zinc-950 border-zinc-800 h-[38px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {entities.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {/* Recurrence */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-zinc-500 mb-1 block">Recurrence</Label>
              <Select value={formData.recurrence || "none"} onValueChange={(v) => setFormData({ ...formData, recurrence: v })}>
                <SelectTrigger className="bg-zinc-950 border-zinc-800 h-[38px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">One-time</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.recurrence && formData.recurrence !== "none" && (
              <div>
                <Label className="text-xs text-zinc-500 mb-1 block">Mode</Label>
                <div className="flex gap-1 bg-zinc-950 border border-zinc-800 rounded-md p-0.5 h-[38px] items-center">
                  <button type="button" onClick={() => setFormData({ ...formData, recurrence_mode: "repeat" })}
                    className={`flex-1 px-2 py-1 text-xs font-medium rounded ${formData.recurrence_mode === "repeat" ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500'}`}>
                    Repeat
                  </button>
                  <button type="button" onClick={() => setFormData({ ...formData, recurrence_mode: "distribute" })}
                    className={`flex-1 px-2 py-1 text-xs font-medium rounded ${formData.recurrence_mode === "distribute" ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-500'}`}>
                    Distribute
                  </button>
                </div>
              </div>
            )}
          </div>
          {formData.recurrence && formData.recurrence !== "none" && (
            <div>
              <Label className="text-xs text-zinc-500 mb-1 block">
                {formData.recurrence_mode === "distribute" ? "# periods" : "# occurrences"}
              </Label>
              <input type="number" min="1" value={formData.recurrence_count || ""}
                onChange={(e) => setFormData({ ...formData, recurrence_count: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 font-mono" />
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button onClick={() => onOpenChange(false)} className="flex-1 btn-secondary text-sm">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 btn-primary text-sm flex items-center justify-center gap-1">
              <Check size={14} /> Save
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const EntryLogPage = ({ entities, onDataChange }) => {
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterType, setFilterType] = useState("all"); // "all" | "inflow" | "outflow"
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
            {/* Parent Row */}
            <div className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/20 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-200 truncate">{flow.label}</span>
                  {flow.recurrence === "monthly" && (
                    <ArrowsClockwise size={12} className="text-amber-400 flex-shrink-0" />
                  )}
                  {flow.recurrence === "quarterly" && (
                    <ArrowsClockwise size={12} className="text-amber-400 flex-shrink-0" />
                  )}
                  {flow.recurrence_mode === "distribute" && (
                    <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1 py-0.5 rounded">Dist</span>
                  )}
                  {linked.length > 0 && (
                    <LinkIcon size={12} className="text-amber-400 flex-shrink-0" />
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
                      <span className="text-xs text-zinc-500">
                        {flow.recurrence_count}x {flow.recurrence}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <span className={`font-mono text-sm font-medium ${flow.amount > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {flow.amount > 0 ? '+' : ''}{formatCurrency(flow.amount)}
              </span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => setEditingFlow(flow)}
                  className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded"
                  data-testid={`edit-${flow.id}`}
                >
                  <PencilSimple size={14} />
                </button>
                <button
                  onClick={() => setDeletingFlow({ flow, hasLinked: linked.length > 0 })}
                  className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded"
                  data-testid={`delete-${flow.id}`}
                >
                  <Trash size={14} />
                </button>
              </div>
            </div>
            {/* Linked Children */}
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
                  <button
                    onClick={() => setEditingFlow(child)}
                    className="p-1 text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 rounded"
                  >
                    <PencilSimple size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          );
        })}
      </div>

      {/* Edit Dialog */}
      <EditFlowDialog
        flow={editingFlow}
        open={!!editingFlow}
        onOpenChange={(open) => !open && setEditingFlow(null)}
        onSave={handleSaved}
        entities={entities}
      />

      {/* Delete Confirmation */}
      <Dialog open={!!deletingFlow} onOpenChange={(open) => !open && setDeletingFlow(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800 max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-zinc-100 font-heading">Delete Entry</DialogTitle>
            <DialogDescription className="text-zinc-500">This cannot be undone from the UI (use undo button).</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-zinc-300">{deletingFlow?.flow?.label}</p>
          <div className="flex flex-col gap-2 mt-2">
            {deletingFlow?.hasLinked && (
              <button
                onClick={() => handleDelete(deletingFlow.flow, true)}
                className="btn-secondary text-sm text-rose-400 border-rose-500/20"
              >
                Delete with linked flows
              </button>
            )}
            <button
              onClick={() => handleDelete(deletingFlow?.flow, false)}
              className="btn-secondary text-sm"
            >
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
