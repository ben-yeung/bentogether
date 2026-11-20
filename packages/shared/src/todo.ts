import { TODO_ITEMS_MAX, type RejectCode, type TodoChange, type TodoItem } from "./protocol";

export type ChangeResult = { items: TodoItem[] } | { code: RejectCode; message: string };

/**
 * Applies one item change to a To-do's list. Pure: the server runs it to
 * decide, and clients run the same function to show their own change before
 * the server answers, replayed on top of whatever others changed meanwhile.
 */
export function applyTodoChange(
  items: readonly TodoItem[],
  change: TodoChange,
  by: string,
  at: number,
): ChangeResult {
  if (change.do === "clearDone") return { items: items.filter((i) => !i.done) };
  const index = items.findIndex((i) => i.id === change.itemId);

  if (change.do === "add") {
    if (index !== -1) return { code: "exists", message: "That item already exists." };
    if (items.length >= TODO_ITEMS_MAX) return { code: "limit", message: "This list is full." };
    return { items: [...items, { id: change.itemId, text: change.text, done: false, by, at }] };
  }

  if (index === -1) return { code: "not_found", message: "That item is gone." };
  const next = [...items];
  const item = next[index]!;
  switch (change.do) {
    case "edit":
      next[index] = { ...item, text: change.text };
      return { items: next };
    case "check":
      next[index] = { ...item, done: change.done };
      return { items: next };
    case "remove":
      next.splice(index, 1);
      return { items: next };
    case "move": {
      next.splice(index, 1);
      next.splice(Math.min(change.to, next.length), 0, item);
      return { items: next };
    }
  }
}
