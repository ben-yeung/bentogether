import type { WidgetDef } from "../types";
import { Poll } from "./Poll";
import { PollPreview } from "./Preview";

export const poll: WidgetDef = {
  kind: "poll",
  name: "Poll",
  blurb: "Ask, and everyone votes.",
  firstColor: "nori",
  View: Poll,
  Preview: PollPreview,
};
