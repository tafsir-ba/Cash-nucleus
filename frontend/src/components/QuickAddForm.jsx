import { useState, useEffect } from "react";
import axios from "axios";
import { Plus, CaretDown, Link, X } from "@phosphor-icons/react";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "../components/ui/select";
import { Label } from "../components/ui/label";
import { EntitySelector } from "./EntitySelector";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const categories = [
  "Revenue", "Salary", "Tax", "Debt", "Expense", "COGS", "Transfer", "Other"
];

const certainties = [
  { value: "Materialized", label: "Materialized" },
  { value: "Sure to happen", label: "Sure" },
  { value: "50/50", label: "50/50" },
  { value: "Idea", label: "Idea" },
];

const getCurrentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

// Get last used entity from localStorage
const getLastEntity = () => localStorage.getItem('lastUsedEntityId') || '';
const setLastEntity = (id) => localStorage.setItem('lastUsedEntityId', id);

const emptyLinkedFlow = () => ({
  id: Date.now(),
  label: "",
  amount: "",
  category: "COGS",
  isPercentage: false,
  percentage: "",
});

export const QuickAddForm = ({ onSuccess, entities, onEntitiesChange }) => {
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Core fields (always visible)
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(getCurrentMonth());
  const [certainty, setCertainty] = useState("Materialized");
  const [entityId, setEntityId] = useState(getLastEntity());
  
  // Advanced fields
  const [category, setCategory] = useState("Expense");
  const [recurrence, setRecurrence] = useState("none");
  const [recurrenceCount, setRecurrenceCount] = useState("");
  const [linkedFlows, setLinkedFlows] = useState([]);

  // Auto-select entity: last used > first available
  useEffect(() => {
    if (!entityId && entities.length > 0) {
      const lastUsed = getLastEntity();
      const validLast = entities.find(e => e.id === lastUsed);
      setEntityId(validLast ? validLast.id : entities[0].id);
    }
  }, [entities, entityId]);

  // Save last used entity
  useEffect(() => {
    if (entityId) setLastEntity(entityId);
  }, [entityId]);

  const addLinkedFlow = () => {
    setLinkedFlows([...linkedFlows, emptyLinkedFlow()]);
  };

  const removeLinkedFlow = (id) => {
    setLinkedFlows(linkedFlows.filter(f => f.id !== id));
  };

  const updateLinkedFlow = (id, field, value) => {
    setLinkedFlows(linkedFlows.map(f => 
      f.id === id ? { ...f, [field]: value } : f
    ));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!label.trim() || !amount || !entityId) return;

    setLoading(true);
    try {
      const dateStr = `${date}-01`;
      const numAmount = parseFloat(amount);
      
      // Build linked flows
      const validLinked = linkedFlows
        .filter(f => f.label.trim() && (f.amount || (f.isPercentage && f.percentage)))
        .map(f => ({
          label: f.label.trim(),
          amount: f.isPercentage ? 0 : parseFloat(f.amount),
          date: dateStr,
          certainty,
          category: f.category,
          recurrence: "none", // Will be overridden by backend
          entity_id: entityId,
          is_percentage: f.isPercentage,
          percentage_of_parent: f.isPercentage ? parseFloat(f.percentage) : null,
        }));

      if (validLinked.length > 0) {
        await axios.post(`${API}/cash-flows/batch`, {
          parent: {
            label: label.trim(),
            amount: numAmount,
            date: dateStr,
            certainty,
            category,
            recurrence,
            recurrence_count: recurrence === "monthly" && recurrenceCount ? parseInt(recurrenceCount) : null,
            entity_id: entityId,
          },
          linked: validLinked
        });
      } else {
        await axios.post(`${API}/cash-flows`, {
          label: label.trim(),
          amount: numAmount,
          date: dateStr,
          certainty,
          category,
          recurrence,
          recurrence_count: recurrence === "monthly" && recurrenceCount ? parseInt(recurrenceCount) : null,
          entity_id: entityId,
        });
      }
      
      // Reset form (keep entity)
      setLabel("");
      setAmount("");
      setDate(getCurrentMonth());
      setCertainty("Materialized");
      setCategory("Expense");
      setRecurrence("none");
      setRecurrenceCount("");
      setLinkedFlows([]);
      
      onSuccess?.();
    } catch (error) {
      console.error("Failed to add cash flow:", error);
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = label.trim() && amount && entityId;

  return (
    <div className="surface-card h-full" data-testid="quick-add-form">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
          Quick Add
        </h2>
      </div>
      
      <form onSubmit={handleSubmit} className="p-4 space-y-3">
        {/* Entity - compact selector */}
        <EntitySelector
          value={entityId}
          onChange={setEntityId}
          entities={entities}
          onEntitiesChange={onEntitiesChange}
        />

        {/* Description */}
        <div>
          <Label htmlFor="desc-input" className="text-xs text-zinc-500 mb-1 block">Description</Label>
          <input
            id="desc-input"
            type="text"
            autoComplete="off"
            placeholder="e.g., Office rent"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-600"
            data-testid="quick-add-label"
          />
        </div>

        {/* Amount + Month (same row for speed) */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs text-zinc-500 mb-1 block">Amount (CHF)</Label>
            <input
              type="number"
              autoComplete="off"
              placeholder="-5000"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-600 font-mono"
              data-testid="quick-add-amount"
            />
          </div>
          <div>
            <Label className="text-xs text-zinc-500 mb-1 block">Month</Label>
            <input
              type="month"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-600"
              data-testid="quick-add-date"
            />
          </div>
        </div>

        {/* Certainty */}
        <div>
          <Label className="text-xs text-zinc-500 mb-1 block">Certainty</Label>
          <Select value={certainty} onValueChange={setCertainty}>
            <SelectTrigger className="w-full bg-zinc-950 border-zinc-800 text-sm h-[38px]" data-testid="quick-add-certainty">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {certainties.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Advanced toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <CaretDown size={12} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          {showAdvanced ? 'Hide' : 'More'} options
        </button>

        {/* Advanced fields */}
        {showAdvanced && (
          <div className="space-y-3 pt-2 border-t border-zinc-800/50">
            {/* Category + Recurrence */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-zinc-500 mb-1 block">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="bg-zinc-950 border-zinc-800 text-sm h-[38px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-zinc-500 mb-1 block">Recurrence</Label>
                <Select value={recurrence} onValueChange={setRecurrence}>
                  <SelectTrigger className="bg-zinc-950 border-zinc-800 text-sm h-[38px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">One-time</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {recurrence === "monthly" && (
              <div>
                <Label className="text-xs text-zinc-500 mb-1 block"># of months</Label>
                <input
                  type="number"
                  placeholder="12"
                  min="1"
                  max="120"
                  value={recurrenceCount}
                  onChange={(e) => setRecurrenceCount(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 placeholder-zinc-500 font-mono"
                />
              </div>
            )}

            {/* Linked Flows */}
            <div className="pt-2 border-t border-zinc-800/50">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Link size={12} className="text-zinc-500" />
                  <span className="text-xs text-zinc-400">Linked Flows</span>
                </div>
                <button
                  type="button"
                  onClick={addLinkedFlow}
                  className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
                >
                  <Plus size={10} /> Add
                </button>
              </div>
              
              {linkedFlows.length === 0 && (
                <p className="text-xs text-zinc-600">e.g., Revenue + COGS</p>
              )}

              {linkedFlows.map((linked) => (
                <div key={linked.id} className="flex gap-1.5 mb-2 items-start bg-zinc-900/50 p-2 rounded border border-zinc-800/50">
                  <div className="flex-1 space-y-1.5">
                    <input
                      type="text"
                      placeholder="Description"
                      value={linked.label}
                      onChange={(e) => updateLinkedFlow(linked.id, "label", e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 text-xs rounded px-2 py-1.5 text-zinc-100 placeholder-zinc-500"
                    />
                    <div className="flex gap-1.5">
                      {/* Toggle: Fixed vs Percentage */}
                      <button
                        type="button"
                        onClick={() => updateLinkedFlow(linked.id, "isPercentage", !linked.isPercentage)}
                        className={`px-2 py-1 text-xs rounded border ${
                          linked.isPercentage 
                            ? 'bg-amber-500/20 border-amber-500/30 text-amber-400'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                        }`}
                      >
                        {linked.isPercentage ? '%' : 'CHF'}
                      </button>
                      
                      {linked.isPercentage ? (
                        <input
                          type="number"
                          placeholder="40"
                          value={linked.percentage}
                          onChange={(e) => updateLinkedFlow(linked.id, "percentage", e.target.value)}
                          className="flex-1 bg-zinc-950 border border-zinc-800 text-xs rounded px-2 py-1.5 text-zinc-100 placeholder-zinc-500 font-mono"
                        />
                      ) : (
                        <input
                          type="number"
                          placeholder="-2000"
                          value={linked.amount}
                          onChange={(e) => updateLinkedFlow(linked.id, "amount", e.target.value)}
                          className="flex-1 bg-zinc-950 border border-zinc-800 text-xs rounded px-2 py-1.5 text-zinc-100 placeholder-zinc-500 font-mono"
                        />
                      )}
                      
                      <Select 
                        value={linked.category} 
                        onValueChange={(v) => updateLinkedFlow(linked.id, "category", v)}
                      >
                        <SelectTrigger className="w-20 bg-zinc-950 border-zinc-800 text-xs h-[30px] px-2">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    {linked.isPercentage && linked.percentage && amount && (
                      <p className="text-xs text-zinc-500">
                        = CHF {Math.round(Math.abs(parseFloat(amount)) * parseFloat(linked.percentage) / 100).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLinkedFlow(linked.id)}
                    className="p-1 text-zinc-500 hover:text-rose-400"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || !canSubmit}
          className="btn-primary w-full flex items-center justify-center gap-2 mt-2"
          data-testid="quick-add-submit"
        >
          <Plus size={14} weight="bold" />
          {loading ? 'Adding...' : linkedFlows.filter(f => f.label && (f.amount || f.percentage)).length > 0 
            ? `Add ${1 + linkedFlows.filter(f => f.label && (f.amount || f.percentage)).length} Flows` 
            : 'Add'}
        </button>
      </form>
    </div>
  );
};
