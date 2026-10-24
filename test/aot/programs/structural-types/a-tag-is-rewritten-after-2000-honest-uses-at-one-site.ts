function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };

function area(s: Shape): number {
  return s.kind === "circle" ? s.radius * 3 : s.side * s.side;
}

function circle(radius: number): Shape {
  return { kind: "circle", radius };
}

function square(side: number): Shape {
  return { kind: "square", side };
}

function retag(t: { kind: "circle" | "square" }): void {
  t.kind = t.kind === "circle" ? "square" : "circle";
}

attempt("one object, one site", () => {
  const s = circle(1);
  let sum = 0;
  for (let i = 0; i < 2004; i++) {
    if (i === 2000) retag(s);
    if (i === 2002) retag(s);
    sum += area(s);
  }
  return sum;
});
attempt("many objects, one site, the last is retagged", () => {
  const shapes: Shape[] = [];
  for (let i = 0; i < 2001; i++) shapes.push(i & 1 ? circle(1) : square(1));
  retag(shapes[2000]);
  let sum = 0;
  let bad = 0;
  for (const s of shapes) {
    const a = area(s);
    if (a !== a) bad++;
    else sum += a;
  }
  return [sum, bad];
});
attempt("a field, read in a method", () => {
  class Holder {
    shape: Shape = circle(2);
    area(): number {
      return this.shape.kind === "circle" ? this.shape.radius * 3 : this.shape.side * this.shape.side;
    }
  }
  const h = new Holder();
  let sum = 0;
  for (let i = 0; i < 2000; i++) sum += h.area();
  retag(h.shape);
  return [sum, h.area()];
});
attempt("a captured shape", () => {
  const s = square(2);
  const read = () => area(s);
  let sum = 0;
  for (let i = 0; i < 2000; i++) sum += read();
  retag(s);
  return [sum, read()];
});
attempt("a result", () => {
  let spoiled = false;
  const make = (): Shape => {
    const s = circle(1);
    if (spoiled) retag(s);
    return s;
  };
  let sum = 0;
  for (let i = 0; i < 2000; i++) sum += area(make());
  spoiled = true;
  return [sum, area(make())];
});
attempt("stored to after the tag lies", () => {
  const grow = (s: Shape): void => {
    if (s.kind === "circle") s.radius += 1;
    else s.side += 1;
  };
  const s = circle(1);
  for (let i = 0; i < 2000; i++) grow(s);
  retag(s);
  grow(s);
  return [JSON.stringify(s), Object.keys(s)];
});
attempt("called after the tag lies", () => {
  type Action = { kind: "run"; run: () => number } | { kind: "wait"; ticks: number };
  const act = (a: Action): number => (a.kind === "run" ? a.run() : a.ticks);
  const waiting: Action = [{ kind: "wait", ticks: 5 } satisfies Action][0];
  let sum = 0;
  for (let i = 0; i < 2000; i++) sum += act(waiting);
  const open: { kind: "run" | "wait" } = waiting;
  open.kind = "run";
  return [sum, act(waiting)];
});
attempt("iterated after the tag lies", () => {
  type Bag = { kind: "many"; items: number[] } | { kind: "one"; item: number };
  const total = (b: Bag): number => {
    if (b.kind === "one") return b.item;
    let sum = 0;
    for (const n of b.items) sum += n;
    return sum;
  };
  const one: Bag = [{ kind: "one", item: 5 } satisfies Bag][0];
  let sum = 0;
  for (let i = 0; i < 2000; i++) sum += total(one);
  const open: { kind: "many" | "one" } = one;
  open.kind = "many";
  return [sum, total(one)];
});
