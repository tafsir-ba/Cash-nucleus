import { useState, useEffect } from "react";
import axios from "axios";
import { Plus, CaretDown, Link, X, CalendarBlank } from "@phosphor-icons/react";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "../components/ui/select";
import { Label } from "../components/ui/label";
import { Calendar } from "../components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { EntitySelector } from "./EntitySelector";
import { format } from "date-fns";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const categories = ["Revenue", "Salary", "Tax", "Debt", "Expense", "COGS", "Transfer", "Other"];

const certainties = [
  { value: "Materialized", label: "Materialized" },
  { value: "Sure to happen", label: "Sure" },
  { value: "50/50", label: "50/50" },
  { value: "Idea", label: "Idea" },
];

const recurrenceOptions = [
  { value: "none", label: "One-time" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
];

const getLastEntity = () => localStorage.getItem('lastUsedEntityId') || '';
const setLastEntity = (id) => localStorage.setItem('lastUsedEntityId', id);

export const QuickAddForm = ({ onSuccess, entities, onEntitiesChange }) => {
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Core fields ONLY (visible by default)
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [certainty, setCertainty] = useState("Materialized");
  const [entityId, setEntityId] = useState(getLastEntity());
  
  // Advanced (hidden by default)
  const [category, setCategory] = useState("Expense");
  const [recurrence, setRecurrence] = useState("none");
  const [recurrenceCount, setRecurrenceCount] = useState("");
  const [linkedFlows, setLinkedFlows] = useState([]);

  useEffect(() => {
    if (!entityId && entities.length > 0) {
      const lastUsed = getLastEntity();
      const valid = entities.find(e => e.id === lastUsed);
      setEntityId(valid ? valid.id : entities[0].id);
    }
  }, [entities, entityId]);

  useEffect(() => {
    if (entityId) setLastEntity(entityId);
  }, [entityId]);

  // Auto-generate linked flow description when using percentage
  const addLinkedFlow = () => {
    setLinkedFlows([...linkedFlows, {
      id: Date.now(),
      label: "",
      amount: "",
      category: "COGS",
      isPercentage: true, // Default to percentage
      percentage: "40", // Common default
    }]);
  };

  const removeLinkedFlow = (id) => setLinkedFlows(linkedFlows.filter(f => f.id !== id));
  
  const updateLinkedFlow = (id, field, value) => {
    setLinkedFlows(linkedFlows.map(f => {
      if (f.id !== id) return f;
      const updated = { ...f, [field]: value };
      // Auto-generate description for percentage flows
      if (field === 'percentage' && updated.isPercentage && !updated.label) {
        updated.label = `COGS (${value}%)`;
      }
      if (field === 'isPercentage' && value && updated.percentage && !updated.label) {
        updated.label = `COGS (${updated.percentage}%)`;
      }
      return updated;
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!label.trim() || !amount || !entityId) return;

    setLoading(true);
    try {
      const dateStr = format(selectedDate, "yyyy-MM") + "-01";
      const numAmount = parseFloat(amount);
      
      const validLinked = linkedFlows
        .filter(f => (f.amount || (f.isPercentage && f.percentage)))
        .map(f => ({
          label: f.label.trim() || (f.isPercentage ? `COGS (${f.percentage}%)` : 'Related cost'),
          amount: f.isPercentage ? 0 : parseFloat(f.amount),
          date: dateStr,
          certainty,
          category: f.category,
          recurrence: "none",
          entity_id: entityId,
          is_percentage: f.isPercentage,
          percentage_of_parent: f.isPercentage ? parseFloat(f.percentage) : null,
        }));

      const payload = {
        label: label.trim(),
        amount: numAmount,
        date: dateStr,
        certainty,
        category,
        recurrence,
        recurrence_count: recurrence !== "none" && recurrenceCount ? parseInt(recurrenceCount) : null,
        entity_id: entityId,
      };

      if (validLinked.length > 0) {
        await axios.post(`${API}/cash-flows/batch`, { parent: payload, linked: validLinked });
      } else {
        await axios.post(`${API}/cash-flows`, payload);
      }
      
      // Reset
      setLabel("");
      setAmount("");
      setSelectedDate(new Date());
      setCertainty("Materialized");
      setCategory("Expense");
      setRecurrence("none");
      setRecurrenceCount("");
      setLinkedFlows([]);
      
      onSuccess?.();
    } catch (error) {
      console.error("Failed to add:", error);
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
        {/* Entity - minimal */}
        <EntitySelector
          value={entityId}
          onChange={setEntityId}
          entities={entities}
          onEntitiesChange={onEntitiesChange}
        />

        {/* Description */}
        <div>
          <Label className="text-xs text-zinc-500 mb-1 block">Description</Label>
          <input
            type="text"
            autoComplete="off"
            placeholder="e.g., Office rent"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-600"
            data-testid="quick-add-label"
          />
        </div>

        {/* Amount + Date */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs text-zinc-500 mb-1 block">Amount</Label>
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
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="w-full flex items-center justify-between bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 hover:bg-zinc-900"
                  data-testid="quick-add-date"
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

        {/* Certainty */}
        <div>
          <Label className="text-xs text-zinc-500 mb-1 block">Certainty</Label>
          <Select value={certainty} onValueChange={setCertainty}>
            <SelectTrigger className="w-full bg-zinc-950 border-zinc-800 text-sm h-[38px]" data-testid="quick-add-certainty">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {certainties.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Advanced toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
        >
          <CaretDown size={12} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          {showAdvanced ? 'Less' : 'More'}
        </button>

        {/* Advanced - ALL hidden by default */}
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
                    {recurrenceOptions.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {recurrence !== "none" && (
              <div>
                <Label className="text-xs text-zinc-500 mb-1 block"># of occurrences</Label>
                <input
                  type="number"
                  placeholder={recurrence === "quarterly" ? "4" : "12"}
                  min="1"
                  value={recurrenceCount}
                  onChange={(e) => setRecurrenceCount(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 placeholder-zinc-500 font-mono"
                />
              </div>
            )}

            {/* Linked Flows - improved UX */}
            <div className="pt-2 border-t border-zinc-800/50">
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
                    <input
                      type="text"
                      placeholder={linked.isPercentage ? `COGS (${linked.percentage || '40'}%)` : "Description"}
                      value={linked.label}
                      onChange={(e) => updateLinkedFlow(linked.id, "label", e.target.value)}
                      className="flex-1 bg-zinc-950 border border-zinc-800 text-xs rounded px-2 py-1.5 text-zinc-100 placeholder-zinc-500"
                    />
                    <button type="button" onClick={() => removeLinkedFlow(linked.id)} className="p-1 text-zinc-500 hover:text-rose-400">
                      <X size={12} />
                    </button>
                  </div>
                  
                  <div className="flex gap-2 items-center">
                    <button
                      type="button"
                      onClick={() => updateLinkedFlow(linked.id, "isPercentage", !linked.isPercentage)}
                      className={`px-2 py-1 text-xs rounded ${
                        linked.isPercentage 
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
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
                        className="w-16 bg-zinc-950 border border-zinc-800 text-xs rounded px-2 py-1.5 text-zinc-100 font-mono"
                      />
                    ) : (
                      <input
                        type="number"
                        placeholder="-2000"
                        value={linked.amount}
                        onChange={(e) => updateLinkedFlow(linked.id, "amount", e.target.value)}
                        className="flex-1 bg-zinc-950 border border-zinc-800 text-xs rounded px-2 py-1.5 text-zinc-100 font-mono"
                      />
                    )}
                    
                    <Select value={linked.category} onValueChange={(v) => updateLinkedFlow(linked.id, "category", v)}>
                      <SelectTrigger className="w-20 bg-zinc-950 border-zinc-800 text-xs h-[30px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {linked.isPercentage && linked.percentage && amount && (
                    <p className="text-xs text-amber-400 mt-1.5">
                      = CHF {Math.round(Math.abs(parseFloat(amount)) * parseFloat(linked.percentage) / 100).toLocaleString()}
                    </p>
                  )}
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
          {loading ? 'Adding...' : 'Add'}
        </button>
      </form>
    </div>
  );
};
