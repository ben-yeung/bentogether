import type { WidgetDef } from "../types";
import { TimerPreview } from "./Preview";
import { Timer } from "./Timer";

export const timer: WidgetDef = {
  kind: "timer",
  name: "Timer",
  blurb: "One countdown for everyone.",
  firstColor: "ume",
  View: Timer,
  Preview: TimerPreview,
};
