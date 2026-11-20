import type { WidgetDef } from "../types";
import { Calendar } from "./Calendar";
import { CalendarPreview } from "./Preview";

export const calendar: WidgetDef = {
  kind: "calendar",
  name: "Calendar",
  blurb: "Plans for everyone, in your time.",
  firstColor: "tamago",
  View: Calendar,
  Preview: CalendarPreview,
};
