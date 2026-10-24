import { fromAForm } from "./form.ts";
import { Point, describe } from "./point.ts";
import { set, swap } from "./set.ts";

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = String(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : String(error));
  }
  console.log(label + " -> " + line);
}

function report(title: string, p: Point): void {
  console.log(title + ": " + describe(p));
  attempt("  sum", () => p.sum());
  attempt("  shout", () => p.shout());
  attempt("  x * 2", () => p.x * 2);
}

const honest = new Point();
let total = 0;
for (let i = 0; i < 2000; i++) {
  set(honest, "x", i);
  set(honest, "y", i / 2);
  set(honest, "name", "n" + (i % 5));
  total += honest.sum() + honest.shout().length;
}
console.log("2000 honest rounds: " + total);
report("honest", honest);

const a = new Point();
fromAForm(a, "name", "from a form");
report("the form sets the name", a);
fromAForm(a, "x", "12");
report("the form sets x", a);
fromAForm(a, "y", "0.25");
report("the form sets y", a);

const b = new Point();
swap(b, "x", "name");
report("x and the name change places", b);
swap(b, "x", "name");
report("and back", b);
report("a fresh one", new Point());
