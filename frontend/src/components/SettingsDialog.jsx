import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";
import { FloppyDisk } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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

export const SettingsDialog = ({ open, onOpenChange, currentBuffer, onDataChange }) => {
  const [buffer, setBuffer] = useState(currentBuffer?.toString() || "50000");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && currentBuffer) {
      setBuffer(currentBuffer.toString());
    }
  }, [open, currentBuffer]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!buffer) return;

    setLoading(true);
    try {
      await axios.put(`${API}/settings`, {
        safety_buffer: parseFloat(buffer),
      });
      toast.success("Settings saved");
      onDataChange?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error("Failed to save settings");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-md" data-testid="settings-dialog">
        <DialogHeader>
          <DialogTitle className="text-zinc-100 font-heading">Settings</DialogTitle>
          <DialogDescription className="text-zinc-500">
            Configure your cash piloting dashboard
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Safety Buffer */}
          <div>
            <Label className="text-sm text-zinc-300 mb-2 block">
              Safety Buffer (CHF)
            </Label>
            <p className="text-xs text-zinc-500 mb-3">
              The minimum cash amount you want to maintain. Falling below this triggers "Watch" status.
            </p>
            <input
              type="number"
              min="0"
              step="1000"
              value={buffer}
              onChange={(e) => setBuffer(e.target.value)}
              className="quick-input font-mono text-lg"
              data-testid="safety-buffer-input"
            />
            <p className="text-xs text-zinc-600 mt-2">
              Current: {formatCurrency(currentBuffer || 50000)}
            </p>
          </div>

          {/* Risk zone explanation */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 space-y-2">
            <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">
              Status Zones
            </h4>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
              <span className="text-sm text-zinc-400">
                <span className="text-emerald-400 font-medium">Good</span> — Above {formatCurrency(parseFloat(buffer) || 50000)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-500"></span>
              <span className="text-sm text-zinc-400">
                <span className="text-amber-400 font-medium">Watch</span> — Between CHF 0 and buffer
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-rose-500"></span>
              <span className="text-sm text-zinc-400">
                <span className="text-rose-400 font-medium">Danger</span> — Below CHF 0
              </span>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full flex items-center justify-center gap-2"
            data-testid="save-settings-btn"
          >
            <FloppyDisk size={16} />
            {loading ? 'Saving...' : 'Save Settings'}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
