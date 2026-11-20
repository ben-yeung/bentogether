import {
  BUDGET_AMOUNT_MAX,
  BUDGET_LOG_MAX,
  type BudgetChange,
  type BudgetLog,
  type RejectCode,
} from "./protocol";

export type BudgetState = { amount: number; log: readonly BudgetLog[] };
export type BudgetResult = { amount: number; log: BudgetLog[] } | { code: RejectCode; message: string };

/**
 * Applies one change to a Budget. Pure, like `applyTodoChange`: the server
 * decides with it, and clients use it to show their own clicks at once.
 * Changes apply in the order they arrive, so a "set" replaces clicks that
 * landed before it and clicks after it add on top.
 */
export function applyBudgetChange(
  state: BudgetState,
  change: BudgetChange,
  who: { name: string; hue: number },
  at: number,
): BudgetResult {
  const amount = change.do === "set" ? change.to : state.amount + change.by;
  if (Math.abs(amount) > BUDGET_AMOUNT_MAX)
    return { code: "limit", message: "That's more than a budget can hold." };
  const entry: BudgetLog = {
    do: change.do,
    amount: change.do === "set" ? change.to : change.by,
    by: who.name,
    hue: who.hue,
    at,
  };
  return { amount, log: [entry, ...state.log].slice(0, BUDGET_LOG_MAX) };
}
