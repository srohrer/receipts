import { Calendar, Hash, ToggleLeft, Tag, Type } from "lucide-react";
import type { ColumnType } from "@/lib/types";

const ICONS = { number: Hash, date: Calendar, category: Tag, text: Type, boolean: ToggleLeft } as const;

export function TypeIcon({ type, className = "size-3 shrink-0 text-faint" }: { type: ColumnType; className?: string }) {
  const Icon = ICONS[type];
  return <Icon className={className} aria-label={type} />;
}
