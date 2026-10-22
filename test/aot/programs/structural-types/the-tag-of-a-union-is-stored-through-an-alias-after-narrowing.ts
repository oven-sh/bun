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
type Tagged = { kind: "circle" | "square" };

function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return s.radius * 3;
    case "square":
      return s.side * s.side;
  }
}

function circle(): Shape {
  return { kind: "circle", radius: 2 };
}

function square(): Shape {
  return { kind: "square", side: 3 };
}

function retag(t: Tagged): void {
  t.kind = t.kind === "circle" ? "square" : "circle";
}

function inALocal(change: boolean): string {
  const s = circle();
  if (s.kind === "circle") {
    if (change) retag(s);
    return s.kind + ":" + s.radius + ":" + area(s);
  }
  return "not a circle";
}

function inAParameter(s: Shape, change: boolean): string {
  if (s.kind === "circle") {
    const alias: Tagged = s;
    if (change) alias.kind = "square";
    return s.kind + ":" + s.radius + ":" + area(s);
  }
  return s.kind + ":" + s.side + ":" + area(s);
}

function made(change: boolean): Shape {
  const s = square();
  if (change) retag(s);
  return s;
}

class Holder {
  shape: Shape = { kind: "circle", radius: 2 };
  read(change: boolean): string {
    if (this.shape.kind === "circle") {
      if (change) retag(this.shape);
      return this.shape.kind + ":" + this.shape.radius + ":" + area(this.shape);
    }
    return "not a circle";
  }
}

function inAnElement(shapes: Shape[], change: boolean): string {
  const first = shapes[0];
  if (first.kind === "circle") {
    if (change) retag(shapes[0]);
    return first.kind + ":" + first.radius + ":" + area(first) + ":" + shapes.map(area).join();
  }
  return "not a circle";
}

function captured(change: boolean): string {
  const s = circle();
  const flip = () => retag(s);
  const read = () => (s.kind === "circle" ? "circle " + s.radius : "square " + s.side);
  const before = read();
  if (change) flip();
  return before + " then " + read() + " area " + area(s);
}

function everything(label: string, change: boolean): void {
  attempt(label + " local", () => inALocal(change));
  attempt(label + " parameter", () => inAParameter({ kind: "circle", radius: 2 }, change));
  attempt(label + " result", () => area(made(change)));
  attempt(label + " result kind", () => {
    const s = made(change);
    return s.kind === "square" ? s.side + 1 : s.radius + 1;
  });
  attempt(label + " field", () => new Holder().read(change));
  attempt(label + " element", () => inAnElement([{ kind: "circle", radius: 2 }, { kind: "square", side: 2 }], change));
  attempt(label + " captured", () => captured(change));
}

everything("honest", false);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += area(i & 1 ? { kind: "circle", radius: i } : { kind: "square", side: 2 }) + inAParameter({ kind: "circle", radius: i }, false).length + inALocal(false).length;
console.log("2000 honest rounds", warm);
everything("retagged", true);
everything("honest again", false);

attempt("in a loop", () => {
  const s = circle();
  const results: number[] = [];
  for (let i = 0; i < 6; i++) {
    if (i === 3) retag(s);
    results.push(area(s));
  }
  return results;
});
attempt("a tag outside the union", () => {
  const s = circle();
  const open: { kind: string } = s;
  open.kind = "triangle";
  return [area(s), typeof area(s), area(s) + 1];
});
attempt("a tag outside the union, after narrowing away one member", () => {
  const s = circle();
  const open: { kind: string } = s;
  open.kind = "triangle";
  if (s.kind === "circle") return "circle";
  return s.kind + ":" + s.side;
});
attempt("the tag is stored with no alias at all", () => {
  const set = (p: Shape) => {
    p.kind = "square";
  };
  const s = circle();
  set(s);
  return [area(s), JSON.stringify(s)];
});
