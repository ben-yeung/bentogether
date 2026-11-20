import type { WidgetKind } from "@bentogether/shared";
import { asks } from "./asks";
import { budget } from "./budget";
import { calendar } from "./calendar";
import { freetimes } from "./freetimes";
import { ideas } from "./ideas";
import { note } from "./note";
import { poll } from "./poll";
import { timer } from "./timer";
import { todo } from "./todo";
import type { WidgetDef } from "./types";

export type { WidgetDef } from "./types";

/**
 * Every kind of widget, in picker order. A new kind gets its own folder
 * (component, styles, picker tile, index.ts) and one line here.
 */
export const WIDGETS: readonly WidgetDef[] = [
  note,
  todo,
  budget,
  timer,
  poll,
  ideas,
  asks,
  freetimes,
  calendar,
];

export const WIDGET_BY_KIND = Object.fromEntries(WIDGETS.map((w) => [w.kind, w])) as Record<
  WidgetKind,
  WidgetDef
>;
