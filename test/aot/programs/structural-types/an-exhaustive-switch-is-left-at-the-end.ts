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
type Light = "red" | "green";

function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return s.radius * 3;
    case "square":
      return s.side * s.side;
  }
}

function areaWithNever(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return s.radius * 3;
    case "square":
      return s.side * s.side;
    default: {
      const rest: never = s;
      return rest;
    }
  }
}

function byIf(s: Shape): number {
  if (s.kind === "circle") return s.radius;
  if (s.kind === "square") return s.side;
  return s;
}

function go(light: Light): string {
  switch (light) {
    case "red":
      return "stop";
    case "green":
      return "go";
  }
}

function assigned(light: Light): number {
  let n: number;
  switch (light) {
    case "red":
      n = 1;
      break;
    case "green":
      n = 2;
      break;
  }
  return n + 1;
}

function triangle(): Shape {
  const s: Shape = { kind: "circle", radius: 2 };
  const open: { kind: string } = s;
  open.kind = "triangle";
  return s;
}

function blue(): Light {
  const box: { light: Light } = { light: "red" };
  const open: { light: string } = box;
  open.light = "blue";
  return box.light;
}

attempt("honest", () => [area({ kind: "circle", radius: 1 }), areaWithNever({ kind: "square", side: 2 }), byIf({ kind: "circle", radius: 1 }), go("red"), go("green"), assigned("red")]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += area({ kind: "square", side: i }) + areaWithNever({ kind: "circle", radius: i }) + byIf({ kind: "square", side: i }) + go(i & 1 ? "red" : "green").length + assigned(i & 1 ? "red" : "green");
console.log("2000 honest rounds", warm);

attempt("area of a triangle", () => area(triangle()));
attempt("area of a triangle, plus one", () => area(triangle()) + 1);
attempt("area of a triangle, toFixed", () => area(triangle()).toFixed(1));
attempt("area of a triangle, in a typed local", () => {
  const n: number = area(triangle());
  const list: number[] = [n, n];
  return [typeof n, list];
});
attempt("never holds the triangle", () => typeof areaWithNever(triangle()));
attempt("never holds the triangle, plus one", () => areaWithNever(triangle()) + 1);
attempt("the chain of ifs hands on the triangle", () => typeof byIf(triangle()));
attempt("go on blue", () => go(blue()));
attempt("go on blue, length", () => go(blue()).length);
attempt("go on blue, glued", () => go(blue()) + "!");
attempt("never assigned on blue", () => assigned(blue()));
attempt("a record indexed by blue", () => {
  const names: Record<Light, number> = { red: 1, green: 2 };
  return names[blue()] + 1;
});
attempt("summed over shapes", () => {
  const shapes: Shape[] = [{ kind: "circle", radius: 1 }, triangle(), { kind: "square", side: 2 }];
  let sum = 0;
  for (const s of shapes) sum += area(s);
  return sum;
});
attempt("honest again", () => [area({ kind: "circle", radius: 1 }), areaWithNever({ kind: "square", side: 2 }), go("red"), assigned("green")]);
