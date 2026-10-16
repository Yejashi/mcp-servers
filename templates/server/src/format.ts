// Records as short text for a model: one line each, the id first, because
// everything a tool returns lands in the model's context.

import type { Item } from "./client.js";

export function itemLine(item: Item): string {
  return [`[${item.id}] ${item.name || "Untitled"}`, item.updated_at ? `updated ${String(item.updated_at).slice(0, 10)}` : undefined].filter(Boolean).join(" · ");
}
