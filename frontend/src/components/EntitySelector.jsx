import { useState, useEffect } from "react";
import axios from "axios";
import { Plus, Check } from "@phosphor-icons/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Label } from "../components/ui/label";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const EntitySelector = ({ value, onChange, entities, onEntitiesChange }) => {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    
    setCreating(true);
    try {
      const response = await axios.post(`${API}/entities`, {
        name: newName.trim()
      });
      onEntitiesChange?.();
      onChange(response.data.id);
      setNewName("");
      setShowCreate(false);
    } catch (error) {
      console.error("Failed to create entity:", error);
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs text-zinc-500">Entity</Label>
        <div className="flex gap-2">
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger 
              className="flex-1 bg-zinc-950 border-zinc-800 text-sm h-[42px]"
              data-testid="entity-selector"
            >
              <SelectValue placeholder="Select entity" />
            </SelectTrigger>
            <SelectContent>
              {entities.map((entity) => (
                <SelectItem key={entity.id} value={entity.id}>
                  {entity.name}
                </SelectItem>
              ))}
              {entities.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-zinc-500">
                  No entities yet
                </div>
              )}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="px-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-md text-zinc-300 transition-colors"
            title="Create new entity"
            data-testid="create-entity-btn"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* Create Entity Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-zinc-900 border-zinc-800 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-zinc-100 font-heading">New Entity</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-zinc-500 mb-1.5 block">Entity Name</Label>
              <input
                type="text"
                placeholder="e.g., Main Company"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2.5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-600"
                autoFocus
                data-testid="new-entity-name"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="btn-primary w-full flex items-center justify-center gap-2"
              data-testid="save-entity-btn"
            >
              <Check size={16} />
              {creating ? "Creating..." : "Create Entity"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
