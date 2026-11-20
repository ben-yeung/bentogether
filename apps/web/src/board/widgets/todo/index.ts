import type { WidgetDef } from "../types";
import { TodoPreview } from "./Preview";
import { Todo } from "./Todo";

export const todo: WidgetDef = {
  kind: "todo",
  name: "To-do",
  blurb: "Check things off together.",
  firstColor: "edamame",
  View: Todo,
  Preview: TodoPreview,
};
