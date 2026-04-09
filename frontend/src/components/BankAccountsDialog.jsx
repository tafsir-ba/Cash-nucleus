import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash, PencilSimple, X } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
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

export const BankAccountsDialog = ({ open, onOpenChange, onDataChange }) => {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    label: "",
    amount: "",
    entity: "",
  });

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

  const resetForm = () => {
    setFormData({ label: "", amount: "", entity: "" });
    setEditingId(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.label || !formData.amount) return;

    setLoading(true);
    try {
      const payload = {
        label: formData.label,
        amount: parseFloat(formData.amount),
        entity: formData.entity,
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
      entity: account.entity || "",
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-lg" data-testid="bank-accounts-dialog">
        <DialogHeader>
          <DialogTitle className="text-zinc-100 font-heading">Bank Accounts</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Total */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4">
            <p className="text-xs text-zinc-500 mb-1">Total Cash Now</p>
            <p className="text-2xl font-mono text-zinc-100">{formatCurrency(totalBalance)}</p>
          </div>

          {/* Account list */}
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {accounts.map((account) => (
              <div 
                key={account.id}
                className="flex items-center justify-between p-3 bg-zinc-950 border border-zinc-800 rounded-md"
              >
                <div>
                  <p className="text-sm text-zinc-200">{account.label}</p>
                  {account.entity && (
                    <p className="text-xs text-zinc-500">{account.entity}</p>
                  )}
                </div>
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
            {accounts.length === 0 && (
              <p className="text-center text-zinc-600 text-sm py-4">
                No bank accounts added yet
              </p>
            )}
          </div>

          {/* Add/Edit form */}
          <form onSubmit={handleSubmit} className="border-t border-zinc-800 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-300">
                {editingId ? 'Edit Account' : 'Add Account'}
              </h3>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Cancel edit
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-zinc-500 mb-1.5 block">Account Name</Label>
                <input
                  type="text"
                  placeholder="e.g., Main checking"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  className="quick-input"
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
                  className="quick-input font-mono"
                  data-testid="account-amount-input"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs text-zinc-500 mb-1.5 block">Entity (optional)</Label>
              <input
                type="text"
                placeholder="e.g., Company name"
                value={formData.entity}
                onChange={(e) => setFormData({ ...formData, entity: e.target.value })}
                className="quick-input"
                data-testid="account-entity-input"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !formData.label || !formData.amount}
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
      </DialogContent>
    </Dialog>
  );
};
