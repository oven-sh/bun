import { Point } from "./point.ts";
import { set } from "./set.ts";

export function fromAForm(p: Point, field: "x" | "y" | "name", text: string): void {
  set(p, field, text);
}
