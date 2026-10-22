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

type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number } | { kind: "label"; text: string; size?: number };
type Result = { ok: true; value: number } | { ok: false; error: string };
type Loose = number | string | null | number[] | { n: number };
type Versioned = { version: 1; name: string } | { version: 2; name: { first: string } };

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return shape.radius * shape.radius * 3;
    case "square":
      return shape.side * shape.side;
    case "label":
      return shape.text.length * (shape.size ?? 1);
  }
}
function unwrap(result: Result): string {
  return result.ok ? "value " + (result.value + 1) : "error " + result.error.toUpperCase();
}
function kindOf(loose: Loose): string {
  if (loose === null) return "null";
  if (typeof loose === "number") return "number " + (loose + 1);
  if (typeof loose === "string") return "string " + loose.length;
  if (Array.isArray(loose)) return "list " + loose.length;
  return "object " + loose.n;
}
function nameOf(value: Versioned): string {
  return value.version === 1 ? value.name : value.name.first;
}

const shapes = [
  '{"kind":"circle","radius":2}',
  '{"radius":2,"kind":"circle"}',
  '{"kind":"square","side":3}',
  '{"side":3,"extra":1,"kind":"square"}',
  '{"kind":"label","text":"abc"}',
  '{"size":2,"text":"abc","kind":"label"}',
  '{"kind":"circle","radius":2,"side":5}',
  '{"side":"not a number","kind":"circle","radius":1}',
  '{"kind":"square","kind":"circle","radius":4}',
  '{"k\\u0069nd":"circle","radius":5}',
  '{"kind":"c\\u0069rcle","radius":6}',
];
for (const text of shapes) {
  attempt(text, () => {
    const shape = JSON.parse<Shape>(text);
    return [shape, area(shape), Object.keys(shape)];
  });
}
attempt("a list of shapes", () => {
  const list = JSON.parse<Shape[]>("[" + shapes.join(",") + "]");
  return list.map(area);
});
for (const text of ['{"ok":true,"value":1}', '{"value":1,"ok":true}', '{"ok":false,"error":"e"}', '{"error":"e","ok":false,"value":"ignored"}']) attempt(text, () => unwrap(JSON.parse<Result>(text)));
for (const text of ["1", "-0", '"text"', "null", "[]", "[1,2]", '{"n":1}', '{"n":1,"m":2}', '""']) attempt("loose " + text, () => [JSON.parse<Loose>(text), kindOf(JSON.parse<Loose>(text))]);
for (const text of ['{"version":1,"name":"a"}', '{"name":{"first":"b"},"version":2}', '{"version":1.0,"name":"c"}', '{"version":2e0,"name":{"first":"d","last":"e"}}']) attempt(text, () => nameOf(JSON.parse<Versioned>(text)));
