import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";
import { 
  Trash, PencilSimple, Link, ArrowsClockwise, 
  CaretDown, CaretRight, X, Check, MagnifyingGlass 
} from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { ScrollArea } from "../components/ui/scroll-area";
import { Label } from "../components/ui/label";
import { inspectAmountInput, formatAmountInput } from "./amountExpression";

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

const categories = [
  "Revenue", "Salary", "Tax", "Debt", "Expense", "COGS", "Transfer", "Other"
];

const certainties = [
  { value: "Materialized", label: "Materialized" },
  { value: "Sure to happen", label: "Sure" },
  { value: "50/50", label: "50/50" },
  { value: "Idea", label: "Idea" },
];

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

// Edit Flow Dialog
const EditFlowDialog = ({ flow, open, onOpenChange, entities, onSave }) => {
  const [formData, setFormData] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (flow) {
      setFormData({
        label: flow.label || "",
        amount: Math.abs(flow.amount || 0).toString(),
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

  const applyAmountExpression = (rawValue) => {
    const inspected = inspectAmountInput(rawValue);
    if (!inspected.text) return true;
    if (!inspected.isValid) {
      toast.error("Invalid amount expression");
      return false;
    }
    if (inspected.hasExpression) {
      setFormData((prev) => ({ ...prev, amount: formatAmountInput(inspected.value) }));
    }
    return true;
  };

  const handleSave = async () => {
    if (!formData.label || !formData.amount) return;
    setSaving(true);
    try {
      const parsedAmount = inspectAmountInput(formData.amount);
      if (!parsedAmount.isValid) {
        toast.error("Invalid amount expression");
        return;
      }
      const rawAmount = parsedAmount.value;
      const signedAmount = formData.category === "Revenue" ? Math.abs(rawAmount) : -Math.abs(rawAmount);
      await axios.put(`${API}/cash-flows/${flow.id}`, {
        label: formData.label,
        amount: signedAmount,
        date: `${formData.date}-01`,
        category: formData.category,
        certainty: formData.certainty,
        recurrence: formData.recurrence,
        recurrence_mode: formData.recurrence !== "none" ? formData.recurrence_mode : "repeat",
        recurrence_count: formData.recurrence !== "none" && formData.recurrence_count 
          ? parseInt(formData.recurrence_count) : null,
        entity_id: formData.entity_id,
      });
      toast.success("Flow updated");
      onSave?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to update:", error);
      toast.error("Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const entityName = entities.find(e => e.id === formData.entity_id)?.name || "Unknown";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-zinc-100 font-heading">Edit Cash Flow</DialogTitle>
          <DialogDescription className="text-zinc-500">Modify cash flow details</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs text-zinc-500 mb-1.5 block">Description</Label>
            <input
              type="text"
              value={formData.label || ""}
              onChange={(e) => setFormData({ ...formData, label: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2.5 text-zinc-100"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-zinc-500 mb-1.5 block">Amount (CHF)</Label>
              <input
                type="text"
                inputMode="decimal"
                value={formData.amount || ""}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                onBlur={(e) => applyAmountExpression(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyAmountExpression(e.currentTarget.value);
                }}
                className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2.5 text-zinc-100 font-mono"
              />
            </div>
            <div>
              <Label className="text-xs text-zinc-500 mb-1.5 block">Month</Label>
              <input
                type="month"
                value={formData.date || ""}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2.5 text-zinc-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-zinc-500 mb-1.5 block">Category</Label>
              <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                <SelectTrigger className="bg-zinc-950 border-zinc-800 h-[42px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-zinc-500 mb-1.5 block">Certainty</Label>
              <Select value={formData.certainty} onValueChange={(v) => setFormData({ ...formData, certainty: v })}>
                <SelectTrigger className="bg-zinc-950 border-zinc-800 h-[42px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {certainties.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs text-zinc-500 mb-1.5 block">Entity</Label>
            <Select value={formData.entity_id} onValueChange={(v) => setFormData({ ...formData, entity_id: v })}>
              <SelectTrigger className="bg-zinc-950 border-zinc-800 h-[42px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {entities.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Recurrence + Mode */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-zinc-500 mb-1.5 block">Recurrence</Label>
              <Select value={formData.recurrence || "none"} onValueChange={(v) => setFormData({ ...formData, recurrence: v })}>
                <SelectTrigger className="bg-zinc-950 border-zinc-800 h-[42px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">One-time</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.recurrence && formData.recurrence !== "none" && (
              <div>
                <Label className="text-xs text-zinc-500 mb-1.5 block">Mode</Label>
                <div className="flex gap-1 bg-zinc-950 border border-zinc-800 rounded-md p-0.5 h-[42px] items-center">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, recurrence_mode: "repeat" })}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                      formData.recurrence_mode === "repeat" ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    Repeat
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, recurrence_mode: "distribute" })}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                      formData.recurrence_mode === "distribute" ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    Distribute
                  </button>
                </div>
              </div>
            )}
          </div>

          {formData.recurrence && formData.recurrence !== "none" && (
            <div>
              <Label className="text-xs text-zinc-500 mb-1.5 block">
                {formData.recurrence_mode === "distribute" ? "# of periods" : "# of occurrences"}
              </Label>
              <input
                type="number"
                min="1"
                value={formData.recurrence_count || ""}
                onChange={(e) => setFormData({ ...formData, recurrence_count: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2.5 text-zinc-100 font-mono"
              />
              {formData.recurrence_mode === "distribute" && formData.amount && formData.recurrence_count && parseInt(formData.recurrence_count) > 0 && (
                <p className="text-xs text-amber-400 mt-1">
                  = CHF {(() => {
                    const parsed = inspectAmountInput(formData.amount);
                    if (!parsed.isValid) return "Invalid amount";
                    return Math.abs(Math.round(parsed.value / parseInt(formData.recurrence_count) * 100) / 100).toLocaleString('de-CH', { minimumFractionDigits: 2 });
                  })()} / {formData.recurrence === "monthly" ? "month" : "quarter"}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={() => onOpenChange(false)}
              className="flex-1 btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 btn-primary flex items-center justify-center gap-2"
            >
              <Check size={16} />
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Flow Entry Row
const FlowEntry = ({ flow, linkedFlows, entities, onEdit, onDelete, expanded, onToggle }) => {
  const hasLinked = linkedFlows && linkedFlows.length > 0;
  const entityName = entities.find(e => e.id === flow.entity_id)?.name || "—";

  return (
    <div className={`border-b border-zinc-800/50 last:border-0 ${hasLinked ? 'bg-zinc-900/20' : ''}`}>
      {/* Main Flow Row */}
      <div 
        className="flex items-center gap-3 p-3 hover:bg-zinc-800/30 transition-colors cursor-pointer"
        onClick={() => hasLinked && onToggle()}
      >
        {/* Expand indicator */}
        <div className="w-5">
          {hasLinked && (
            expanded 
              ? <CaretDown size={14} className="text-amber-400" />
              : <CaretRight size={14} className="text-amber-400" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm text-zinc-200 truncate font-medium">{flow.label}</span>
            {flow.recurrence === "monthly" && (
              <ArrowsClockwise size={14} className="text-amber-400 flex-shrink-0" title="Recurring" />
            )}
            {flow.recurrence === "quarterly" && (
              <ArrowsClockwise size={14} className="text-amber-400 flex-shrink-0" title="Quarterly" />
            )}
            {flow.recurrence_mode === "distribute" && (
              <span className="text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded" title="Amount distributed across periods">
                Dist
              </span>
            )}
            {hasLinked && (
              <span className="flex items-center gap-1 text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">
                <Link size={10} /> {linkedFlows.length} linked
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>{formatDate(flow.date)}</span>
            <span>·</span>
            <span>{flow.category}</span>
            <span>·</span>
            <span>{entityName}</span>
          </div>
        </div>

        {/* Amount & Actions */}
        <div className="flex items-center gap-3">
          <CertaintyBadge certainty={flow.certainty} />
          <span className={`text-sm font-mono min-w-[100px] text-right ${flow.amount < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
            {flow.amount < 0 ? '-' : '+'}{formatCurrency(flow.amount)}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(flow); }}
            className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
            data-testid={`edit-flow-${flow.id}`}
          >
            <PencilSimple size={16} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(flow, hasLinked); }}
            className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 rounded transition-colors"
            data-testid={`delete-flow-${flow.id}`}
          >
            <Trash size={16} />
          </button>
        </div>
      </div>

      {/* Linked Flows - stronger visual grouping */}
      {expanded && hasLinked && (
        <div className="bg-zinc-950/50 border-t border-zinc-800/30">
          <div className="pl-8 pr-3 py-1 text-xs text-zinc-500 uppercase tracking-wider">
            Linked to "{flow.label}"
          </div>
          {linkedFlows.map((linked) => (
            <div 
              key={linked.id}
              className="flex items-center gap-3 px-3 py-2 ml-5 border-l-2 border-amber-500/40 hover:bg-zinc-800/20"
            >
              <Link size={12} className="text-amber-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm text-zinc-300">{linked.label}</span>
                <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
                  <span>{linked.category}</span>
                  {linked.is_percentage && linked.percentage_of_parent && (
                    <span className="text-amber-400">({linked.percentage_of_parent}% of parent)</span>
                  )}
                </div>
              </div>
              <span className={`text-sm font-mono ${linked.amount < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {linked.amount < 0 ? '-' : '+'}{formatCurrency(linked.amount)}
              </span>
              <button
                onClick={() => onEdit(linked)}
                className="p-1 text-zinc-500 hover:text-zinc-300"
              >
                <PencilSimple size={14} />
              </button>
              <button
                onClick={() => onDelete(linked, false)}
                className="p-1 text-zinc-500 hover:text-rose-400"
              >
                <Trash size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const EntryLogDialog = ({ open, onOpenChange, entities, onDataChange, selectedEntityId }) => {
  const [flowsWithLinked, setFlowsWithLinked] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedFlows, setExpandedFlows] = useState({});
  const [editingFlow, setEditingFlow] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const fetchFlows = async () => {
    setLoading(true);
    try {
      const params = selectedEntityId ? { entity_id: selectedEntityId } : {};
      const response = await axios.get(`${API}/cash-flows/with-linked`, { params });
      setFlowsWithLinked(response.data);
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

  const handleDelete = async (flow, hasLinked) => {
    if (hasLinked) {
      setDeleteConfirm({ flow, hasLinked });
    } else {
      await confirmDelete(flow.id, false);
    }
  };

  const confirmDelete = async (flowId, deleteLinked) => {
    try {
      await axios.delete(`${API}/cash-flows/${flowId}?delete_linked=${deleteLinked}`);
      toast.success("Deleted");
      fetchFlows();
      onDataChange?.();
    } catch (error) {
      console.error("Failed to delete:", error);
      toast.error("Failed to delete");
    }
    setDeleteConfirm(null);
  };

  const toggleExpand = (flowId) => {
    setExpandedFlows(prev => ({ ...prev, [flowId]: !prev[flowId] }));
  };

  const handleEditSave = () => {
    fetchFlows();
    onDataChange?.();
  };

  // Filter and search
  const filteredFlows = flowsWithLinked.filter(({ flow }) => {
    if (filter === "inflows" && flow.amount <= 0) return false;
    if (filter === "outflows" && flow.amount >= 0) return false;
    if (search && !flow.label.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalIn = flowsWithLinked.reduce((sum, { flow, linked_flows }) => {
    let total = flow.amount > 0 ? flow.amount : 0;
    linked_flows.forEach(lf => { if (lf.amount > 0) total += lf.amount; });
    return sum + total;
  }, 0);

  const totalOut = flowsWithLinked.reduce((sum, { flow, linked_flows }) => {
    let total = flow.amount < 0 ? Math.abs(flow.amount) : 0;
    linked_flows.forEach(lf => { if (lf.amount < 0) total += Math.abs(lf.amount); });
    return sum + total;
  }, 0);

  const totalCount = flowsWithLinked.reduce((sum, { linked_flows }) => sum + 1 + linked_flows.length, 0);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-zinc-900 border-zinc-800 max-w-3xl max-h-[85vh]" data-testid="entry-log-dialog">
          <DialogHeader>
            <DialogTitle className="text-zinc-100 font-heading">Entry Log</DialogTitle>
            <DialogDescription className="text-zinc-500">View, edit, and manage all cash flow entries</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3">
                <p className="text-xs text-zinc-500 mb-1">Total Entries</p>
                <p className="text-lg font-mono text-zinc-100">{totalCount}</p>
              </div>
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-md p-3">
                <p className="text-xs text-emerald-400 mb-1">Total Inflows</p>
                <p className="text-lg font-mono text-emerald-400">+{formatCurrency(totalIn)}</p>
              </div>
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-md p-3">
                <p className="text-xs text-rose-400 mb-1">Total Outflows</p>
                <p className="text-lg font-mono text-rose-400">-{formatCurrency(totalOut)}</p>
              </div>
            </div>

            {/* Search & Filter */}
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Search entries..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md pl-9 pr-3 py-2 text-zinc-100 placeholder-zinc-500"
                />
              </div>
              <div className="flex gap-1 bg-zinc-950 border border-zinc-800 rounded-md p-1">
                {["all", "inflows", "outflows"].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      filter === f ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Flow list */}
            <ScrollArea className="h-[400px] border border-zinc-800 rounded-md">
              {loading ? (
                <div className="text-center py-8 text-zinc-500">Loading...</div>
              ) : filteredFlows.length === 0 ? (
                <div className="text-center py-8 text-zinc-600">
                  {search ? "No matching entries" : "No entries yet"}
                </div>
              ) : (
                <div>
                  {filteredFlows.map(({ flow, linked_flows }) => (
                    <FlowEntry
                      key={flow.id}
                      flow={flow}
                      linkedFlows={linked_flows}
                      entities={entities}
                      expanded={expandedFlows[flow.id]}
                      onToggle={() => toggleExpand(flow.id)}
                      onEdit={setEditingFlow}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <EditFlowDialog
        flow={editingFlow}
        open={!!editingFlow}
        onOpenChange={(open) => !open && setEditingFlow(null)}
        entities={entities}
        onSave={handleEditSave}
      />

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-zinc-100 font-heading">Delete Entry</DialogTitle>
            <DialogDescription className="text-zinc-500">Confirm deletion</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">
              This entry has {deleteConfirm?.flow && deleteConfirm.hasLinked ? "linked flows" : ""}. 
              What would you like to delete?
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => confirmDelete(deleteConfirm?.flow?.id, false)}
                className="btn-secondary text-left px-4"
              >
                Delete parent only
              </button>
              <button
                onClick={() => confirmDelete(deleteConfirm?.flow?.id, true)}
                className="bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30 px-4 py-2 rounded-md text-sm font-medium"
              >
                Delete with all linked flows
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="text-zinc-500 hover:text-zinc-300 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
