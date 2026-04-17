import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, X, Link, Check, CaretDown, CalendarBlank } from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "../components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import { Label } from "../components/ui/label";
import { Calendar } from "../components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { format, parse } from "date-fns";
import { inspectAmountInput, formatAmountInput } from "./amountExpression";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const categories = ["Revenue", "Salary", "Tax", "Debt", "Expense", "COGS", "Transfer", "Other"];
const certainties = [
  { value: "Materialized", label: "Materialized" },
  { value: "Sure to happen", label: "Sure" },
  { value: "50/50", label: "50/50" },
  { value: "Idea", label: "Idea" },
];

/**
 * Canonical Flow Editor — used for BOTH create and edit.
 * Props:
 *  - flow: null for create, object for edit
 *  - open / onOpenChange: dialog control
 *  - entities: entity list
 *  - onSave: callback after save
 *  - onEntitiesChange: callback to refresh entities
 */
export const FlowEditor = ({ flow, open, onOpenChange, entities, onSave, onEntitiesChange }) => {
  const isEdit = !!flow;

  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [certainty, setCertainty] = useState("Materialized");
  const [category, setCategory] = useState("Expense");
  const [entityId, setEntityId] = useState("");
  const [recurrence, setRecurrence] = useState("none");
  const [recurrenceMode, setRecurrenceMode] = useState("repeat");
  const [recurrenceCount, setRecurrenceCount] = useState("");
  const [linkedFlows, setLinkedFlows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [existingLinked, setExistingLinked] = useState([]);
  const [priority, setPriority] = useState("");

  // Load data when opening for edit
  useEffect(() => {
    if (open && isEdit && flow) {
      setLabel(flow.label || "");
      setAmount(Math.abs(flow.amount)?.toString() || "");
      try {
        const d = parse(flow.date?.substring(0, 7), "yyyy-MM", new Date());
        setSelectedDate(d);
      } catch { setSelectedDate(new Date()); }
      setCertainty(flow.certainty || "Materialized");
      setCategory(flow.category || "Expense");
      setEntityId(flow.entity_id || "");
      setRecurrence(flow.recurrence || "none");
      setRecurrenceMode(flow.recurrence_mode || "repeat");
      setRecurrenceCount(flow.recurrence_count?.toString() || "");
      setPriority(flow.priority || "");
      setLinkedFlows([]);
      // Load existing linked flows
      axios.get(`${API}/cash-flows`).then(res => {
        const children = res.data.filter(f => f.parent_id === flow.id);
        setExistingLinked(children);
      }).catch(() => {});
    } else if (open && !isEdit) {
      // Reset for create mode
      setLabel("");
      setAmount("");
      setSelectedDate(new Date());
      setCertainty("Materialized");
      setCategory("Expense");
      setEntityId(entities[0]?.id || "");
      setRecurrence("none");
      setRecurrenceMode("repeat");
      setRecurrenceCount("");
      setLinkedFlows([]);
      setExistingLinked([]);
      setPriority("");
    }
  }, [open, flow, isEdit, entities]);

  const addLinkedFlow = () => {
    setLinkedFlows([...linkedFlows, {
      id: Date.now(),
      label: "",
      category: "COGS",
      isPercentage: true,
      percentage: "40",
      amount: "",
    }]);
  };

  const removeLinkedFlow = (id) => setLinkedFlows(linkedFlows.filter(f => f.id !== id));

  const updateLinkedFlow = (id, field, value) => {
    setLinkedFlows(linkedFlows.map(f => {
      if (f.id !== id) return f;
      const updated = { ...f, [field]: value };
      if (field === 'percentage' && updated.isPercentage && !updated.label) {
        updated.label = `COGS (${value}%)`;
      }
      return updated;
    }));
  };

  const applyAmountExpression = (rawValue, setter) => {
    const inspected = inspectAmountInput(rawValue);
    if (!inspected.text) return true;
    if (!inspected.isValid) {
      toast.error("Invalid amount expression");
      return false;
    }
    if (inspected.hasExpression) {
      setter(formatAmountInput(inspected.value));
    }
    return true;
  };

  const handleSave = async () => {
    if (!label.trim() || !amount || !entityId) return;
    setSaving(true);

    try {
      const dateStr = format(selectedDate, "yyyy-MM") + "-01";
      const parsedMainAmount = inspectAmountInput(amount);
      if (!parsedMainAmount.isValid) {
        toast.error("Invalid amount expression");
        return;
      }
      const numAmount = parsedMainAmount.value;
      const signedAmount = category === "Revenue" ? Math.abs(numAmount) : -Math.abs(numAmount);

      if (isEdit) {
        // Update existing flow
        await axios.put(`${API}/cash-flows/${flow.id}`, {
          label: label.trim(),
          amount: signedAmount,
          date: dateStr,
          certainty,
          category,
          recurrence,
          recurrence_mode: recurrence !== "none" ? recurrenceMode : "repeat",
          recurrence_count: recurrence !== "none" && recurrenceCount ? parseInt(recurrenceCount) : null,
          entity_id: entityId,
          priority: priority || null,
        });
        toast.success("Updated");
      } else {
        // Create new flow
        const payload = {
          label: label.trim(),
          amount: signedAmount,
          date: dateStr,
          certainty,
          category,
          recurrence,
          recurrence_mode: recurrence !== "none" ? recurrenceMode : "repeat",
          recurrence_count: recurrence !== "none" && recurrenceCount ? parseInt(recurrenceCount) : null,
          entity_id: entityId,
          priority: priority || null,
        };

        const validLinked = [];
        for (const f of linkedFlows) {
          if (!(f.amount || (f.isPercentage && f.percentage))) continue;

          let linkedAmount = 0;
          if (!f.isPercentage) {
            const parsedLinkedAmount = inspectAmountInput(f.amount);
            if (!parsedLinkedAmount.isValid) {
              toast.error("Invalid linked flow amount");
              return;
            }
            linkedAmount = f.category === "Revenue"
              ? Math.abs(parsedLinkedAmount.value)
              : -Math.abs(parsedLinkedAmount.value);
          }

          validLinked.push({
            label: f.label.trim() || (f.isPercentage ? `COGS (${f.percentage}%)` : 'Cost'),
            amount: linkedAmount,
            date: dateStr,
            certainty,
            category: f.category,
            recurrence: "none",
            entity_id: entityId,
            is_percentage: f.isPercentage,
            percentage_of_parent: f.isPercentage ? parseFloat(f.percentage) : null,
          });
        }

        if (validLinked.length > 0) {
          await axios.post(`${API}/cash-flows/batch`, { parent: payload, linked: validLinked });
        } else {
          await axios.post(`${API}/cash-flows`, payload);
        }
        toast.success("Added");
      }

      onSave?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(isEdit ? "Update failed" : "Create failed");
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const isRecurring = recurrence !== "none";
  const isDistribute = recurrenceMode === "distribute";
  const parsedAmountForPreview = inspectAmountInput(amount);
  const amountForPreview = parsedAmountForPreview.isValid ? parsedAmountForPreview.value : null;
  const hasDistributePreview = isDistribute && amountForPreview !== null && recurrenceCount && parseInt(recurrenceCount) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-zinc-100 font-heading">
            {isEdit ? "Edit Flow" : "New Flow"}
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            {isEdit ? `Editing: ${flow?.label}` : "All fields available"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Label */}
          <div>
            <Label className="text-xs text-zinc-500 mb-1 block">Description</Label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g., Office rent"
              className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100"
              autoFocus
              data-testid="editor-label"
            />
          </div>

          {/* Amount + Date */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-zinc-500 mb-1 block">
                {isDistribute ? "Total Amount" : "Amount (CHF)"}
              </Label>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onBlur={(e) => applyAmountExpression(e.target.value, setAmount)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyAmountExpression(e.currentTarget.value, setAmount);
                }}
                placeholder="5000"
                className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 font-mono"
                data-testid="editor-amount"
              />
            </div>
            <div>
              <Label className="text-xs text-zinc-500 mb-1 block">Month</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center justify-between bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 hover:bg-zinc-900"
                    data-testid="editor-date"
                  >
                    <span>{format(selectedDate, "MMM yyyy")}</span>
                    <CalendarBlank size={16} className="text-zinc-500" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-zinc-900 border-zinc-800" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => date && setSelectedDate(date)}
                    defaultMonth={selectedDate}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Category + Entity */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-zinc-500 mb-1 block">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="bg-zinc-950 border-zinc-800 text-sm h-[38px]" data-testid="editor-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-zinc-500 mb-1 block">Entity</Label>
              <Select value={entityId} onValueChange={setEntityId}>
                <SelectTrigger className="bg-zinc-950 border-zinc-800 text-sm h-[38px]" data-testid="editor-entity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {entities.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Certainty + Recurrence */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-zinc-500 mb-1 block">Certainty</Label>
              <Select value={certainty} onValueChange={setCertainty}>
                <SelectTrigger className="bg-zinc-950 border-zinc-800 text-sm h-[38px]" data-testid="editor-certainty">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {certainties.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-zinc-500 mb-1 block">Recurrence</Label>
              <Select value={recurrence} onValueChange={setRecurrence}>
                <SelectTrigger className="bg-zinc-950 border-zinc-800 text-sm h-[38px]" data-testid="editor-recurrence">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">One-time</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Recurrence Mode (always visible when recurring) */}
          {isRecurring && (
            <div className="p-2.5 rounded-md bg-zinc-900/50 border border-zinc-800/50 space-y-2">
              <div className="flex gap-1 bg-zinc-950 border border-zinc-800 rounded-md p-0.5" data-testid="editor-recurrence-mode">
                <button type="button" onClick={() => setRecurrenceMode("repeat")}
                  className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                    !isDistribute ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                  }`}>
                  Repeat full amount
                </button>
                <button type="button" onClick={() => setRecurrenceMode("distribute")}
                  className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                    isDistribute ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-500 hover:text-zinc-300'
                  }`}>
                  Distribute total
                </button>
              </div>
              <div>
                <Label className="text-xs text-zinc-500 mb-1 block">
                  {isDistribute ? "# periods (required)" : "# occurrences"}
                </Label>
                <input type="number" min="1" value={recurrenceCount}
                  onChange={(e) => setRecurrenceCount(e.target.value)}
                  placeholder={recurrence === "quarterly" ? "4" : "12"}
                  className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 font-mono"
                  data-testid="editor-recurrence-count" />
              </div>
              {hasDistributePreview && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-md p-2">
                  <p className="text-sm font-mono text-amber-300">
                    ≈ CHF {Math.abs(Math.round(amountForPreview / parseInt(recurrenceCount) * 100) / 100).toLocaleString('de-CH', { minimumFractionDigits: 2 })} / {recurrence === "monthly" ? "month" : "quarter"}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Existing Linked Flows (edit mode) */}
          {/* Priority */}
          <div>
            <Label className="text-xs text-zinc-500 mb-1 block">Priority</Label>
            <div className="flex gap-1" data-testid="editor-priority">
              {[
                { value: "", label: "None", cls: "text-zinc-500 bg-zinc-800 border-zinc-700" },
                { value: "critical", label: "Critical", cls: "text-rose-400 bg-rose-500/10 border-rose-500/30" },
                { value: "flexible", label: "Flexible", cls: "text-amber-400 bg-amber-500/10 border-amber-500/30" },
                { value: "strategic", label: "Strategic", cls: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30" },
              ].map(opt => (
                <button key={opt.value} type="button" onClick={() => setPriority(opt.value)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    priority === opt.value ? opt.cls : 'text-zinc-600 bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Existing Linked Flows (edit mode) */}
          {isEdit && existingLinked.length > 0 && (
            <div className="border-t border-zinc-800/50 pt-2">
              <span className="text-xs text-zinc-500 flex items-center gap-1.5 mb-2">
                <Link size={12} className="text-amber-400" /> Existing Linked Flows
              </span>
              {existingLinked.map(child => (
                <div key={child.id} className="flex items-center justify-between p-2 bg-zinc-900/50 border border-amber-500/10 rounded mb-1">
                  <span className="text-xs text-zinc-400">
                    └ {child.label}
                    {child.is_percentage && <span className="text-amber-500/60 ml-1">{child.percentage_of_parent}%</span>}
                  </span>
                  <span className="text-xs font-mono text-rose-400">
                    CHF {Math.abs(child.amount).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* New Linked Flows (create mode or add new in edit) */}
          {!isEdit && (
            <div className="border-t border-zinc-800/50 pt-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-zinc-400 flex items-center gap-1.5">
                  <Link size={12} className="text-amber-400" /> Linked Flows
                </span>
                <button type="button" onClick={addLinkedFlow} className="text-xs text-amber-400 hover:text-amber-300">
                  + Add COGS
                </button>
              </div>
              {linkedFlows.map((linked) => (
                <div key={linked.id} className="mb-2 p-2 rounded bg-zinc-900/50 border border-amber-500/20">
                  <div className="flex gap-2 items-center mb-2">
                    <input type="text"
                      placeholder={linked.isPercentage ? `COGS (${linked.percentage || '40'}%)` : "Description"}
                      value={linked.label}
                      onChange={(e) => updateLinkedFlow(linked.id, "label", e.target.value)}
                      className="flex-1 bg-zinc-950 border border-zinc-800 text-xs rounded px-2 py-1.5 text-zinc-100 placeholder-zinc-500" />
                    <button type="button" onClick={() => removeLinkedFlow(linked.id)} className="p-1 text-zinc-500 hover:text-rose-400">
                      <X size={12} />
                    </button>
                  </div>
                  <div className="flex gap-2 items-center">
                    <button type="button" onClick={() => updateLinkedFlow(linked.id, "isPercentage", !linked.isPercentage)}
                      className={`px-2 py-1 text-xs rounded ${linked.isPercentage ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'}`}>
                      {linked.isPercentage ? '%' : 'CHF'}
                    </button>
                    {linked.isPercentage ? (
                      <input type="number" placeholder="40" value={linked.percentage}
                        onChange={(e) => updateLinkedFlow(linked.id, "percentage", e.target.value)}
                        className="w-16 bg-zinc-950 border border-zinc-800 text-xs rounded px-2 py-1.5 text-zinc-100 font-mono" />
                    ) : (
                      <input type="text" inputMode="decimal" placeholder="2000" value={linked.amount}
                        onChange={(e) => updateLinkedFlow(linked.id, "amount", e.target.value)}
                        onBlur={(e) => applyAmountExpression(e.target.value, (v) => updateLinkedFlow(linked.id, "amount", v))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            applyAmountExpression(e.currentTarget.value, (v) => updateLinkedFlow(linked.id, "amount", v));
                          }
                        }}
                        className="flex-1 bg-zinc-950 border border-zinc-800 text-xs rounded px-2 py-1.5 text-zinc-100 font-mono" />
                    )}
                    <Select value={linked.category} onValueChange={(v) => updateLinkedFlow(linked.id, "category", v)}>
                      <SelectTrigger className="w-20 bg-zinc-950 border-zinc-800 text-xs h-[30px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {linked.isPercentage && linked.percentage && amount && (
                    <p className="text-xs text-amber-400 mt-1.5">
                      {amountForPreview !== null && isDistribute && recurrenceCount && parseInt(recurrenceCount) > 0
                        ? `≈ CHF ${Math.round(Math.abs(amountForPreview / parseInt(recurrenceCount)) * parseFloat(linked.percentage) / 100).toLocaleString()}/period`
                        : amountForPreview !== null
                          ? `= CHF ${Math.round(Math.abs(amountForPreview) * parseFloat(linked.percentage) / 100).toLocaleString()}`
                          : "Invalid amount"}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button onClick={() => onOpenChange(false)} className="flex-1 btn-secondary text-sm">Cancel</button>
            <button onClick={handleSave} disabled={saving || !label.trim() || !amount || !entityId}
              className="flex-1 btn-primary text-sm flex items-center justify-center gap-1"
              data-testid="editor-save">
              <Check size={14} /> {isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
