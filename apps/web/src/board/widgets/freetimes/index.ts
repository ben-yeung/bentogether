import type { WidgetDef } from "../types";
import { FreeTimes } from "./FreeTimes";
import { FreeTimesPreview } from "./Preview";

export const freetimes: WidgetDef = {
  kind: "freetimes",
  name: "Free times",
  blurb: "Find when everyone's free.",
  firstColor: "edamame",
  View: FreeTimes,
  Preview: FreeTimesPreview,
};
