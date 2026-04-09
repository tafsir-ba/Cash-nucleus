import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Buildings } from "@phosphor-icons/react";

export const EntityFilter = ({ entities, selectedId, onChange }) => {
  if (entities.length <= 1) return null;

  return (
    <div className="flex items-center gap-2 ml-4 pl-4 border-l border-zinc-800">
      <Buildings size={16} className="text-zinc-500" />
      <Select value={selectedId || "all"} onValueChange={(v) => onChange(v === "all" ? null : v)}>
        <SelectTrigger 
          className="w-[160px] bg-zinc-900 border-zinc-800 text-sm h-8"
          data-testid="entity-filter"
        >
          <SelectValue placeholder="All entities" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All entities</SelectItem>
          {entities.map((entity) => (
            <SelectItem key={entity.id} value={entity.id}>
              {entity.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
