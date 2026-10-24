import * as fresh from "widgets-new";
import * as old from "widgets-old";
import type { Widget } from "widgets-old";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function area(w: Widget): number {
  return w.area();
}

function border(w: Widget): number {
  return 2 * (w.width + w.height);
}

function describe(w: Widget): unknown {
  return [w.width, w.height, area(w), border(w), w instanceof old.Widget, w instanceof fresh.Widget, old.isWidget(w), fresh.isWidget(w), Object.keys(w).join()];
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += area(old.make(i, 2)) + border(old.make(i, 2));
console.log("2000 rounds with the old build: " + warm);

attempt("the old build", () => describe(old.make(2, 3)));
attempt("the new build", () => describe(fresh.make(2, 3)));
attempt("constructed here", () => [describe(new old.Widget(2, 3)), describe(new fresh.Widget(2, 3))]);
attempt("a method of one build on an instance of the other", () => old.Widget.prototype.area.call(fresh.make(2, 3)));
attempt("and the other way round", () => fresh.Widget.prototype.area.call(old.make(2, 3)));
attempt("static members", () => [typeof old.Widget.count, typeof fresh.Widget.count, fresh.Widget.count + 1]);
attempt("in one list", () => {
  const widgets: Widget[] = [old.make(1, 2), fresh.make(3, 4), old.make(5, 6)];
  let total = 0;
  for (const w of widgets) total += w.area() + w.width;
  return total;
});
attempt("subclasses of both", () => {
  class OldChild extends old.Widget {
    depth = 1;
  }
  class NewChild extends fresh.Widget {
    depth = 1;
  }
  return [describe(new OldChild(2, 3)), describe(new NewChild(2, 3))];
});
attempt("the old build without new", () => Reflect.apply(old.Widget, undefined, [1, 2]));
attempt("the new build without new", () => Reflect.apply(fresh.Widget, undefined, [1, 2]));
