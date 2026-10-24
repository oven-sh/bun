function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
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

type HasLength = { length: number };
type Fixable = { toFixed(digits: number): string };

function total(items: HasLength[]): number {
  let sum = 0;
  for (let i = 0; i < items.length; i++) sum += items[i].length;
  return sum;
}

function totalWithALocal(items: HasLength[]): number {
  let sum = 0;
  let current: HasLength = { length: 0 };
  for (let i = 0; i < items.length; i++) {
    current = items[i];
    sum += current.length;
  }
  return sum + current.length;
}

function kindsSeen(items: HasLength[]): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(typeof item, (counts.get(typeof item) ?? 0) + 1);
  return [...counts].map(([kind, count]) => kind + "=" + count).join();
}

function lastDigits(items: Fixable[]): string {
  let text = "";
  for (let i = 0; i < items.length; i++) {
    const fixed = items[i].toFixed(1);
    if (i % 1000 === 500) text += fixed + ";";
  }
  return text;
}

function build(at: number, visitor: HasLength): HasLength[] {
  const items: HasLength[] = [];
  for (let i = 0; i < 4000; i++) items.push(i === at ? visitor : { length: 1 });
  return items;
}

const visitors: [string, HasLength][] = [
  ["nothing unusual", { length: 1 }],
  ["a string", "hello world"],
  ["an empty string", ""],
  ["an array", [1, 2, 3]],
  ["a function", total],
  ["a typed array", new Uint32Array(7)],
];

for (const [name, visitor] of visitors) {
  for (const at of [0, 1500, 3999]) {
    attempt(name + " at " + at + ": total", () => total(build(at, visitor)));
    attempt(name + " at " + at + ": through a local", () => totalWithALocal(build(at, visitor)));
    attempt(name + " at " + at + ": kinds", () => kindsSeen(build(at, visitor)));
  }
}

attempt("a number among objects with toFixed", () => {
  const items: Fixable[] = [];
  for (let i = 0; i < 4000; i++) items.push(i === 1500 || i === 2500 ? i / 4 : { toFixed: digits => "o" + digits });
  return lastDigits(items);
});
attempt("an object among numbers", () => {
  const items: Fixable[] = [];
  for (let i = 0; i < 4000; i++) items.push(i === 1500 ? { toFixed: digits => "o" + digits } : i / 4);
  return lastDigits(items);
});
attempt("stored in the middle of the loop", () => {
  const items = build(-1, "");
  let sum = 0;
  for (let i = 0; i < items.length; i++) {
    if (i === 2000) items[2001] = "a string of 17 ch";
    sum += items[i].length;
  }
  return sum;
});
