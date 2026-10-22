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

interface Record1 {
  count: number;
  name: string;
  on: boolean;
  list: number[];
  inner: { x: number };
  maybe?: number;
}

function countPlus(r: Record1): number {
  return r.count + 1;
}
function nameLength(r: Record1): number {
  return r.name.length;
}
function onText(r: Record1): string {
  return r.on ? "on" : "off";
}
function listSum(r: Record1): number {
  let sum = 0;
  for (const n of r.list) sum += n;
  return sum;
}
function innerX(r: Record1): number {
  return r.inner.x * 2;
}
function maybeOr(r: Record1): number {
  return r.maybe ?? -1;
}

const good = { count: "1", name: '"n"', on: "true", list: "[1,2]", inner: '{"x":3}', maybe: "4" };
const values = ["1.5", '"text"', "false", "null", "[]", '["a"]', "{}", '{"x":"y"}', '{"length":2}'];
function textWith(key: string, value: string | undefined): string {
  const parts: string[] = [];
  for (const [name, held] of Object.entries(good)) {
    if (name !== key) parts.push(JSON.stringify(name) + ":" + held);
    else if (value !== undefined) parts.push(JSON.stringify(name) + ":" + value);
  }
  return "{" + parts.join(",") + "}";
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const r: Record1 = { count: i, name: "n", on: true, list: [i], inner: { x: i } };
  warm += countPlus(r) + nameLength(r) + onText(r).length + listSum(r) + innerX(r) + maybeOr(r);
}
console.log("2000 honest literals", warm);

const uses: [string, (r: Record1) => unknown][] = [
  ["count", countPlus],
  ["name", nameLength],
  ["on", onText],
  ["list", listSum],
  ["inner", innerX],
  ["maybe", maybeOr],
];
for (const [key, use] of uses) {
  for (const value of [...values, undefined]) {
    attempt(key + " is " + (value ?? "missing"), () => {
      const r: Record1 = JSON.parse(textWith(key, value));
      return [use(r), Object.keys(r).length];
    });
  }
}
attempt("direct calls with a text for the count", () => {
  const r: Record1 = JSON.parse(textWith("count", '"7"'));
  return [countPlus(r), r.count, typeof r.count, r.count + 1, r.count * 2, nameLength(r), listSum(r)];
});
attempt("honest text", () => {
  const r: Record1 = JSON.parse(textWith("", undefined));
  return [countPlus(r), nameLength(r), onText(r), listSum(r), innerX(r), maybeOr(r), JSON.stringify(r)];
});
