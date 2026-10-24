import { count, limit, list, make, nope, options, pair, sound, step, Widget } from "broken";

interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
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

function plusOne(n: number): number {
  return n + 1;
}

function sum(p: Point): number {
  return p.x + p.y;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const n: number = make("number");
  const p: Point = make("point");
  warm += plusOne(n) + sum(p) + sound(i);
}
console.log("2000 honest rounds: " + warm);

for (const kind of ["number", "text", "nothing", "point", "texts", "list", "unknown"]) {
  attempt("a result of a type that does not exist, " + kind + ", as a number", () => {
    const n: number = make(kind);
    return [n + 1, plusOne(n), typeof n];
  });
  attempt("a result of a type that does not exist, " + kind + ", as a point", () => {
    const p: Point = make(kind);
    return [p.x, sum(p)];
  });
}
attempt("a constant of a misspelled type", () => {
  const n: number = limit;
  return [n + 1, plusOne(limit), typeof limit];
});
attempt("a tuple", () => {
  const [a, b] = pair();
  const n: number = b;
  return [a + 1, plusOne(a), n + 1];
});
attempt("a type from a module that is not there", () => {
  const n: number = nope();
  return n + 1;
});
attempt("a list", () => {
  const numbers: number[] = list();
  return numbers.map(plusOne);
});
attempt("a function", () => {
  const f: (n: number) => number = step();
  return [f(1), f(1) + 1];
});
attempt("an interface with a parent that is not there", () => [options().size, options().size + 1, plusOne(options().size), Object.keys(options()).join()]);
attempt("a class with a parent that is not there", () => {
  const widget = new Widget();
  return [widget.width, widget.width + 1, widget.grow(), plusOne(widget.grow()), Object.keys(widget).join()];
});
attempt("a subclass of it", () => {
  class Wide extends Widget {
    extra = 1;
    both(): number {
      return this.width + this.extra;
    }
  }
  const wide = new Wide();
  return [wide.both(), Object.keys(wide).join()];
});
attempt("a constant declared twice", () => [typeof count, show(count)]);
attempt("what is declared well", () => [sound(1), plusOne(sound(1))]);
