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

interface Sequence {
  length: number;
  slice(start?: number, end?: number): Sequence;
  indexOf(item: string, from?: number): number;
  lastIndexOf(item: string): number;
  includes(item: string): boolean;
  at(index: number): string | undefined;
  concat(...others: string[]): Sequence;
  [index: number]: string;
  [Symbol.iterator](): Iterator<string>;
}

const uses: [string, (s: Sequence) => unknown][] = [
  ["length", s => s.length],
  ["typeof", s => typeof s],
  ["slice(1)", s => s.slice(1)],
  ["slice(-2, -1)", s => s.slice(-2, -1)],
  ["slice().length", s => s.slice().length],
  ["slice() is the same", s => s.slice() === s],
  ["indexOf b", s => s.indexOf("b")],
  ["indexOf bc", s => s.indexOf("bc")],
  ["indexOf nothing", s => s.indexOf("")],
  ["indexOf b from 2", s => s.indexOf("b", 2)],
  ["lastIndexOf b", s => s.lastIndexOf("b")],
  ["includes bc", s => s.includes("bc")],
  ["includes nothing", s => s.includes("")],
  ["at(-1)", s => s.at(-1)],
  ["at(10)", s => s.at(10)],
  ["concat", s => s.concat("x", "y")],
  ["concat().length", s => s.concat("xy").length],
  ["[0]", s => s[0]],
  ["[10]", s => s[10]],
  ["spread", s => [...s]],
  ["slice of a slice", s => s.slice(1).slice(1)],
  ["JSON", s => JSON.stringify(s)],
];

function countB(s: Sequence): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === "b") count++;
  return count;
}

function joinUp(s: Sequence): string {
  let text = "";
  for (const item of s) text += item + "-";
  return text;
}

function store(s: Sequence, index: number, item: string): string {
  s[index] = item;
  return s[index];
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = ["a", "b", "c", "b"];
  warm += countB(honest) + joinUp(honest).length + store(honest, 0, "z").length;
  for (const [, use] of uses) use(honest);
}
console.log("after 2000 arrays", warm);

const values: [string, () => Sequence][] = [
  ["array", () => ["a", "b", "c", "b"]],
  ["string", () => "abcb"],
  ["glued string", () => "ab".concat("cb")],
  ["empty array", () => []],
  ["empty string", () => ""],
  ["array of longer strings", () => ["ab", "bc", ""]],
];
for (const [name, make] of values) {
  for (const [use, run] of uses) attempt(name + ": " + use, () => run(make()));
  attempt(name + ": count b", () => countB(make()));
  attempt(name + ": join up", () => joinUp(make()));
  attempt(name + ": store at 0", () => store(make(), 0, "z"));
  attempt(name + ": store at 9", () => store(make(), 9, "z"));
}
