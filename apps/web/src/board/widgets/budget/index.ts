import type { WidgetDef } from "../types";
import { Budget } from "./Budget";
import { BudgetPreview } from "./Preview";

export const budget: WidgetDef = {
  kind: "budget",
  name: "Budget",
  blurb: "What's left to spend.",
  firstColor: "tamago",
  View: Budget,
  Preview: BudgetPreview,
};
