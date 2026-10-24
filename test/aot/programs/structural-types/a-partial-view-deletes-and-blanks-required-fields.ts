function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Point {
  x = 1;
  y = 2.5;
  name = "p";
  sum(): number {
    return this.x + this.y;
  }
  shout(): string {
    return this.name.toUpperCase();
  }
}

function remove<T extends object>(target: T, key: keyof T): void {
  const view: Partial<T> = target;
  delete view[key];
}

function blank<T extends object>(target: T, key: keyof T): void {
  const view: Partial<T> = target;
  view[key] = undefined;
}

function report(title: string, p: Point): void {
  console.log(title + ": " + typeof p.x + " " + show(p.x) + ", " + typeof p.y + " " + show(p.y) + ", " + typeof p.name + " " + show(p.name) + ", keys " + Object.keys(p).join() + ", " + JSON.stringify(p) + ", x in it: " + ("x" in p) + ", own: " + Object.hasOwn(p, "x"));
  attempt("  sum", () => p.sum());
  attempt("  shout", () => p.shout());
  attempt("  x + 1", () => p.x + 1);
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const p = new Point();
  p.x = i;
  total += p.sum() + p.shout().length;
}
console.log("2000 honest rounds: " + total);

const a = new Point();
blank(a, "x");
report("x is blanked", a);
a.x = 5;
report("and stored again", a);

const b = new Point();
remove(b, "x");
report("x is deleted", b);
b.x = 5;
report("and stored again: it is the last key now", b);

const c = new Point();
remove(c, "y");
remove(c, "name");
report("y and the name are deleted", c);
c.name = "again";
c.y = 0.5;
report("and stored again in the other order", c);

const d = new Point();
const view: Partial<Point> = d;
delete view.x;
view.name = undefined;
report("without a generic function", d);

const e = new Point();
remove(e, "sum");
report("a method is deleted from the instance: nothing happens", e);
blank(e, "sum");
report("a method is blanked on the instance", e);

const points = [new Point(), new Point(), new Point()];
remove(points[1], "x");
attempt("a sum over three points, one without x", () => points.reduce((sum, p) => sum + p.x, 0));
attempt("their keys", () => points.map(p => Object.keys(p).join("")));
report("a fresh one", new Point());

export {};
