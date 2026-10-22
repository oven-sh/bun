interface Point {
  x: number;
  y: number;
}

class Pixel {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

enum Color {
  Red,
  Green,
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
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

function sum(p: Point): number {
  return p.x + p.y;
}

function key(text: string) {
  return JSON.parse(text);
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const p: Point = { x: i, y: 1 };
  p[key('"x"')] = i + 1;
  warm += sum(p) + p[key('"y"')] + new Pixel().sum();
}
console.log("2000 honest rounds: " + warm);

attempt("a store of a text under an untyped key", () => {
  const p: Point = { x: 1, y: 2 };
  p[key('"x"')] = "text";
  return [p.x, typeof p.x, sum(p), JSON.stringify(p)];
});
attempt("a store under a new name", () => {
  const p: Point = { x: 1, y: 2 };
  p[key('"z"')] = 3;
  p[key("0")] = "zero";
  return [sum(p), Object.keys(p).join(), JSON.stringify(p)];
});
attempt("a delete under an untyped key", () => {
  const p: Point = { x: 1, y: 2 };
  delete p[key('"x"')];
  return [p.x, sum(p), "x" in p, Object.keys(p).join()];
});
attempt("an update under an untyped key", () => {
  const p: Point = { x: 1, y: 2 };
  p[key('"x"')] += "!";
  p[key('"y"')]++;
  return [p.x, p.y, sum(p)];
});
attempt("a read as another type", () => {
  const p: Point = { x: 1, y: 2 };
  const s: string = p[key('"x"')];
  const missing: number = p[key('"w"')];
  const inherited: number = p[key('"toString"')];
  return [s + "!", typeof s, missing + 1, typeof inherited];
});
attempt("a computed member of a literal covers a declared one", () => {
  const p: Point = { x: 1, y: 2, [key('"x"')]: "covered" };
  return [p.x, typeof p.x, sum(p), Object.keys(p).join()];
});
attempt("a computed member before the declared one", () => {
  const p: Point = { [key('"y"')]: "first", x: 1, y: 2 };
  return [p.y, sum(p), Object.keys(p).join()];
});
attempt("a computed member under another name", () => {
  const p: Point = { x: 1, [key('"w"')]: 0, y: 2 };
  return [sum(p), Object.keys(p).join(), JSON.stringify(p)];
});
attempt("an instance: a field", () => {
  const p = new Pixel();
  p[key('"x"')] = "text";
  return [p.x, p.sum(), JSON.stringify(p)];
});
attempt("an instance: a method", () => {
  const p = new Pixel();
  p[key('"sum"')] = () => "replaced";
  return [p.sum(), new Pixel().sum(), Object.keys(p).join()];
});
attempt("an instance: a method called under an untyped key", () => {
  const p = new Pixel();
  const n: number = p[key('"sum"')]();
  return [n + 1, p[key('"nothing"')]];
});
attempt("an instance: what is not there is called", () => new Pixel()[key('"nothing"')]());
attempt("the prototype under an untyped key", () => {
  const p = new Pixel();
  p[key('"__proto__"')] = { sum: () => "another prototype" };
  return [p.sum(), p instanceof Pixel, Object.keys(p).join()];
});
attempt("a list of numbers", () => {
  const list = [1, 2, 3];
  list[key("1")] = key('"two"');
  list[key('"5"')] = 6;
  list[key('"name"')] = key('"named"');
  let total = 0;
  for (const n of list) total += n;
  return [list, total, list.length, Object.keys(list).join()];
});
attempt("the length of a list", () => {
  const list = [1, 2, 3];
  list[key('"length"')] = 1;
  return [list, list.length];
});
attempt("an enum", () => {
  const name: string = Color[key("1")];
  const none: string = Color[key("7")];
  const value: string = Color[key('"Red"')];
  return [name, none, value, typeof value, value + "!", none + "!"];
});
attempt("keys that are no texts", () => {
  const p: Point = { x: 1, y: 2 };
  p[key("null")] = "under null";
  p[key("true")] = "under true";
  p[key('["x"]')] = "under a list";
  p[key("{}")] = "under an object";
  return [p.x, Object.keys(p).join()];
});
attempt("frozen", () => {
  const p: Point = Object.freeze({ x: 1, y: 2 });
  p[key('"x"')] = 5;
  return p.x;
});

export {};
