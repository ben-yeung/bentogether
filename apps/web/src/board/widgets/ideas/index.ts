import type { WidgetDef } from "../types";
import { Ideas } from "./Ideas";
import { IdeasPreview } from "./Preview";

export const ideas: WidgetDef = {
  kind: "ideas",
  name: "Ideas",
  blurb: "Pitch ideas, upvote the best.",
  firstColor: "shiso",
  View: Ideas,
  Preview: IdeasPreview,
};
