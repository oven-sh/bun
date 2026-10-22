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

interface Item {
  id: number;
  name: string;
  list: number[];
}
type Shape = { kind: "a"; x: number } | { kind: "b"; y: string };

function classOf(run: () => unknown): string {
  try {
    run();
    return "value";
  } catch (error) {
    return error instanceof Error ? error.constructor.name : typeof error;
  }
}

const items = [
  '{"id":"wrong","name":"n","list":[]',
  '{"id":"wrong","name":"n","list":[]}}',
  '{"id":"wrong",',
  '{"id":null,"name":1,"list":{}} x',
  '{"id":1,"name":"n","list":["wrong",]}',
  '{"id":1,"name":"n","list":["wrong"',
  '{"list":"wrong","id":1,"name":"n"',
  '[1,2,3',
  '"text',
  "nul",
  "12x",
  '{"id":1e400,"name":"n","list":[]',
  '{"missing":true',
  "{}}",
  "[]]",
  "null null",
];
for (const text of items) attempt(JSON.stringify(text), () => classOf(() => JSON.parse<Item>(text)));

const shapes = ['{"kind":"c","x":1', '{"kind":"a","x":"wrong"', '{"kind":"a","y":"of b",}', '{"kind":1]', '{"kind":"b","y":2}{'];
for (const text of shapes) attempt("shape " + JSON.stringify(text), () => classOf(() => JSON.parse<Shape>(text)));

attempt("mistyped far before the break", () => {
  const parts: string[] = [];
  for (let i = 0; i < 5000; i++) parts.push(i === 3 ? '"wrong"' : String(i));
  return classOf(() => JSON.parse<Item>('{"id":1,"name":"n","list":[' + parts.join(",") + "]"));
});
