import type { WidgetDef } from "../types";
import { Asks } from "./Asks";
import { AsksPreview } from "./Preview";

export const asks: WidgetDef = {
  kind: "asks",
  name: "Asks",
  blurb: "What each teammate needs.",
  firstColor: "sake",
  View: Asks,
  Preview: AsksPreview,
};
