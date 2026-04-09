import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash, PencilSimple } from "@phosphor-icons/react";
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
import { Label } from "../components/ui/label";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency: 'CHF',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export const BankAccountsDialog = ({ open, onOpenChange, onDataChange, entities, onEntitiesChange }) => {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    label: "",
    amount: "",
    entity_id: "",
  });
  const [showEntityCreate, setShowEntityCreate] = useState(false);
  const [newEntityName, setNewEntityName] = useState("");

  const fetchAccounts = async () => {
    try {
      const response = await axios.get(`${API}/bank-accounts`);
      setAccounts(response.data);
    } catch (error) {
      console.error("Failed to fetch accounts:", error);
    }
  };

  useEffect(() => {
    if (open) {
      fetchAccounts();
    }
  }, [open]);

  // Auto-select first entity
  useEffect(() => {
    if (entities.length > 0 && !formData.entity_id) {
      setFormData(f => ({ ...f, entity_id: entities[0].id }));
    }
  }, [entities, formData.entity_id]);

  const resetForm = () => {
    setFormData({ 
      label: "", 
      amount: "", 
      entity_id: entities.length > 0 ? entities[0].id : "" 
    });
    setEditingId(null);
  };

  const handleCreateEntity = async () => {
    if (!newEntityName.trim()) return;
    try {
      const response = await axios.post(`${API}/entities`, { name: newEntityName.trim() });
      onEntitiesChange?.();
      setFormData(f => ({ ...f, entity_id: response.data.id }));
      setNewEntityName("");
      setShowEntityCreate(false);
      toast.success("Entity created");
    } catch (error) {
      console.error("Failed to create entity:", error);
      toast.error("Failed to create entity");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.label || !formData.amount || !formData.entity_id) return;

    setLoading(true);
    try {
      const payload = {
        label: formData.label,
        amount: parseFloat(formData.amount),
        entity_id: formData.entity_id,
      };

      if (editingId) {
        await axios.put(`${API}/bank-accounts/${editingId}`, payload);
        toast.success("Account updated");
      } else {
        await axios.post(`${API}/bank-accounts`, payload);
        toast.success("Account added");
      }

      resetForm();
      fetchAccounts();
      onDataChange?.();
    } catch (error) {
      console.error("Failed to save account:", error);
      toast.error("Failed to save account");
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (account) => {
    setEditingId(account.id);
    setFormData({
      label: account.label,
      amount: account.amount.toString(),
      entity_id: account.entity_id,
    });
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this bank account?")) return;

    try {
      await axios.delete(`${API}/bank-accounts/${id}`);
      toast.success("Account deleted");
      fetchAccounts();
      onDataChange?.();
    } catch (error) {
      console.error("Failed to delete account:", error);
      toast.error("Failed to delete account");
    }
  };

  const totalBalance = accounts.reduce((sum, acc) => sum + acc.amount, 0);

  // Group accounts by entity
  const accountsByEntity = {};
  accounts.forEach(acc => {
    const entityId = acc.entity_id;
    if (!accountsByEntity[entityId]) {
      accountsByEntity[entityId] = [];
    }
    accountsByEntity[entityId].push(acc);
  });

  const getEntityName = (entityId) => {
    return entities.find(e => e.id === entityId)?.name || "Unknown";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-lg" data-testid="bank-accounts-dialog">
        <DialogHeader>
          <DialogTitle className="text-zinc-100 font-heading">Bank Accounts</DialogTitle>
          <DialogDescription className="text-zinc-500">Manage your bank accounts and balances</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Total */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4">
            <p className="text-xs text-zinc-500 mb-1">Total Cash Now</p>
            <p className="text-2xl font-mono text-zinc-100">{formatCurrency(totalBalance)}</p>
          </div>

          {/* Account list grouped by entity */}
          <div className="space-y-3 max-h-[250px] overflow-y-auto">
            {entities.length === 0 ? (
              <p className="text-center text-zinc-600 text-sm py-4">
                Create an entity first to add bank accounts
              </p>
            ) : Object.keys(accountsByEntity).length === 0 ? (
              <p className="text-center text-zinc-600 text-sm py-4">
                No bank accounts added yet
              </p>
            ) : (
              Object.entries(accountsByEntity).map(([entityId, entityAccounts]) => (
                <div key={entityId} className="border border-zinc-800 rounded-md overflow-hidden">
                  <div className="bg-zinc-800/50 px-3 py-2 text-xs font-medium text-zinc-400">
                    {getEntityName(entityId)}
                  </div>
                  {entityAccounts.map((account) => (
                    <div 
                      key={account.id}
                      className="flex items-center justify-between p-3 bg-zinc-950 border-t border-zinc-800"
                    >
                      <p className="text-sm text-zinc-200">{account.label}</p>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono text-zinc-300">
                          {formatCurrency(account.amount)}
                        </span>
                        <button
                          onClick={() => handleEdit(account)}
                          className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
                          data-testid={`edit-account-${account.id}`}
                        >
                          <PencilSimple size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(account.id)}
                          className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 rounded transition-colors"
                          data-testid={`delete-account-${account.id}`}
                        >
                          <Trash size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>

          {/* Add/Edit form */}
          <form onSubmit={handleSubmit} className="border-t border-zinc-800 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-300">
                {editingId ? 'Edit Account' : 'Add Account'}
              </h3>
              {editingId && (
                <button type="button" onClick={resetForm} className="text-xs text-zinc-500 hover:text-zinc-300">
                  Cancel edit
                </button>
              )}
            </div>

            {/* Entity selector */}
            <div>
              <Label className="text-xs text-zinc-500 mb-1.5 block">Entity</Label>
              <div className="flex gap-2">
                <Select value={formData.entity_id} onValueChange={(v) => setFormData({ ...formData, entity_id: v })}>
                  <SelectTrigger className="flex-1 bg-zinc-950 border-zinc-800 h-[42px]">
                    <SelectValue placeholder="Select entity" />
                  </SelectTrigger>
                  <SelectContent>
                    {entities.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={() => setShowEntityCreate(true)}
                  className="px-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-md text-zinc-300"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-zinc-500 mb-1.5 block">Account Name</Label>
                <input
                  type="text"
                  placeholder="e.g., Main checking"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2.5 text-zinc-100 placeholder-zinc-500"
                  data-testid="account-label-input"
                />
              </div>
              <div>
                <Label className="text-xs text-zinc-500 mb-1.5 block">Balance (CHF)</Label>
                <input
                  type="number"
                  placeholder="0"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2.5 text-zinc-100 placeholder-zinc-500 font-mono"
                  data-testid="account-amount-input"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !formData.label || !formData.amount || !formData.entity_id}
              className="btn-primary w-full flex items-center justify-center gap-2"
              data-testid="save-account-btn"
            >
              {editingId ? (
                <>
                  <PencilSimple size={16} />
                  Update Account
                </>
              ) : (
                <>
                  <Plus size={16} weight="bold" />
                  Add Account
                </>
              )}
            </button>
          </form>
        </div>

        {/* Create Entity Mini-Dialog */}
        {showEntityCreate && (
          <div className="absolute inset-0 bg-zinc-950/80 flex items-center justify-center rounded-lg">
            <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg w-64 space-y-3">
              <h4 className="text-sm font-medium text-zinc-200">New Entity</h4>
              <input
                type="text"
                placeholder="Entity name"
                value={newEntityName}
                onChange={(e) => setNewEntityName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateEntity()}
                className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setShowEntityCreate(false)}
                  className="flex-1 btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateEntity}
                  disabled={!newEntityName.trim()}
                  className="flex-1 btn-primary text-xs"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
