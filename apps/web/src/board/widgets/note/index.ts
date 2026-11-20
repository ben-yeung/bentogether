import type { WidgetDef } from "../types";
import { Note } from "./Note";
import { NotePreview } from "./Preview";

export const note: WidgetDef = {
  kind: "note",
  name: "Sticky Note",
  blurb: "Live, shared text.",
  View: Note,
  Preview: NotePreview,
};
