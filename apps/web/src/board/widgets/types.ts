import type { Component } from "solid-js";
import type { NoteColor, WidgetKind } from "@bentogether/shared";
import type { WidgetProps } from "../frame/WidgetFrame";

/**
 * Everything the board and the picker need to know about one kind of
 * widget. Each kind lives in its own folder under widgets/ and exports
 * one of these from its index.ts.
 */
export type WidgetDef = {
  kind: WidgetKind;
  /** Picker label and one-line hint. */
  name: string;
  blurb: string;
  /** Color it starts in; without one, new ones take turns through the ingredients. */
  firstColor?: NoteColor;
  /** The widget itself, inside the shared frame. */
  View: Component<WidgetProps>;
  /** The small drawing on its picker tile. */
  Preview: Component;
};
