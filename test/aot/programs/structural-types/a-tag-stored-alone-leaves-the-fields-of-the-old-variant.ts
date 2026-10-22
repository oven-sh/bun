function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number; label: string } | { kind: "dot" };

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return shape.radius * shape.radius * 3;
    case "square":
      return shape.side * shape.side;
    case "dot":
      return 0;
  }
}
function labelOf(shape: Shape): string {
  return shape.kind === "square" ? shape.label : shape.kind;
}
function labelLength(shape: Shape): number {
  return shape.kind === "square" ? shape.label.length : -1;
}
function retag(shape: Shape, kind: Shape["kind"]): void {
  shape.kind = kind;
}
function look(shape: Shape): unknown[] {
  return [shape.kind, Object.keys(shape), JSON.stringify(shape), area(shape), labelOf(shape)];
}

const makers: [string, () => Shape][] = [
  ["circle", () => ({ kind: "circle", radius: 2 })],
  ["square", () => ({ kind: "square", side: 3, label: "three" })],
  ["dot", () => ({ kind: "dot" })],
];
const kinds: Shape["kind"][] = ["circle", "square", "dot"];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const shape = makers[i % 3][1]();
  warm += area(shape) + labelOf(shape).length + labelLength(shape);
}
console.log("2000 honest rounds", warm);

for (const [from, make] of makers) {
  for (const to of kinds) {
    attempt(from + " tagged " + to, () => {
      const shape = make();
      retag(shape, to);
      return look(shape);
    });
    attempt(from + " tagged " + to + ", the label is used", () => {
      const shape = make();
      retag(shape, to);
      return labelLength(shape);
    });
  }
}
attempt("tagged in the middle of a list", () => {
  const shapes: Shape[] = [makers[0][1](), makers[1][1](), makers[2][1]()];
  retag(shapes[0], "square");
  retag(shapes[1], "circle");
  retag(shapes[2], "circle");
  return [shapes.map(area), shapes.map(labelOf)];
});
attempt("tagged after it was narrowed", () => {
  const shape = makers[0][1]();
  if (shape.kind !== "circle") return "no circle";
  const alias: Shape = shape;
  retag(alias, "square");
  return [shape.kind, shape.radius, area(shape), area(alias)];
});
attempt("tagged and tagged back", () => {
  const shape = makers[1][1]();
  retag(shape, "dot");
  const between = look(shape);
  retag(shape, "square");
  return [between, look(shape)];
});
attempt("honest again", () => makers.map(([, make]) => look(make())));
