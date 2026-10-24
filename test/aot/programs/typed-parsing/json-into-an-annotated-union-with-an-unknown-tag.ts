function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number } | { kind: "label"; text: string };

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return shape.radius * shape.radius * 3;
    case "square":
      return shape.side * shape.side;
    case "label":
      return shape.text.length;
  }
}
function describe(shape: Shape): string {
  if (shape.kind === "circle") return "circle " + shape.radius;
  if (shape.kind === "square") return "square " + shape.side;
  if (shape.kind === "label") return "label " + shape.text;
  const rest: never = shape;
  return "never " + show(rest);
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += area(i % 3 === 0 ? { kind: "circle", radius: i } : i % 3 === 1 ? { kind: "square", side: i } : { kind: "label", text: "t" });
console.log("2000 honest literals", warm);

const texts = [
  '{"kind":"circle","radius":2}',
  '{"kind":"triangle","base":1}',
  '{"radius":2}',
  '{"kind":"circle"}',
  '{"kind":"circle","side":2}',
  '{"kind":"square","radius":2}',
  '{"kind":"label"}',
  '{"kind":"label","text":5}',
  '{"kind":"label","text":null}',
  '{"kind":"circle","radius":"2"}',
  '{"kind":null}',
  '{"kind":0}',
  '{"kind":["circle"],"radius":2}',
  '{"kind":"circle","kind":"square","radius":2,"side":3}',
  '{"kind":"CIRCLE","radius":2}',
  "[]",
  "null",
  '"circle"',
  "0",
];
for (const text of texts) {
  attempt(text + " area", () => {
    const shape: Shape = JSON.parse(text);
    return [area(shape), typeof area(shape)];
  });
  attempt(text + " described", () => {
    const shape: Shape = JSON.parse(text);
    return describe(shape);
  });
}
attempt("in one list", () => {
  const shapes: Shape[] = JSON.parse("[" + texts.slice(0, 6).join(",") + "]");
  return [shapes.map(area), shapes.map(describe)];
});
