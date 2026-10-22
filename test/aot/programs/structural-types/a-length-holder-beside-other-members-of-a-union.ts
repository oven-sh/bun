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

function orANumber(x: HasLength | number): number {
  return typeof x === "number" ? x : x.length;
}

function orNothing(x: HasLength | null | undefined): number {
  return x == null ? -1 : x.length;
}

function onlyIfAnObject(x: HasLength | undefined): number {
  if (typeof x === "object") return x.length;
  return -1;
}

function notUndefined(x: HasLength | undefined): number {
  if (typeof x !== "undefined") return x.length;
  return -1;
}

function orASize(x: HasLength | { size: number }): number {
  return "length" in x ? x.length : x.size;
}

function orAString(x: HasLength | string): string {
  return typeof x === "string" ? x.toUpperCase() : "length " + x.length;
}

function orAThunk(x: HasLength | (() => number)): number {
  return typeof x === "function" ? x() + 1 : x.length;
}

function orAList(x: HasLength | number[]): string {
  return Array.isArray(x) ? "list " + x.length : "other " + x.length;
}

function orBytes(x: HasLength | Uint8Array): string {
  return x instanceof Uint8Array ? "bytes " + x.byteLength : "other " + x.length;
}

function orABoolean(x: HasLength | boolean): string {
  if (x === true) return "true";
  if (x === false) return "false";
  return "length " + x.length;
}

function joinTwo(a: string, b: string): string {
  return a + b;
}

const values: [string, HasLength][] = [
  ["literal", { length: 3 }],
  ["string", "hello"],
  ["empty string", ""],
  ["array", [1, 2]],
  ["function of two strings", joinTwo],
  ["bytes", new Uint8Array(4)],
  ["String object", new String("abc")],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = { length: i };
  warm += orANumber(honest) + orANumber(i) + orNothing(honest) + orNothing(null) + onlyIfAnObject(honest) + notUndefined(honest);
  warm += orASize(honest) + orASize({ size: i }) + orAString(honest).length + orAThunk(honest) + orAThunk(() => i);
  warm += orAList(honest).length + orBytes(honest).length + orABoolean(honest).length + orABoolean(i % 2 === 0).length;
}
console.log("after 2000 honest calls", warm);

for (const [name, value] of values) {
  attempt(name + ": or a number", () => orANumber(value));
  attempt(name + ": or nothing", () => orNothing(value));
  attempt(name + ": only if typeof says object", () => onlyIfAnObject(value));
  attempt(name + ": if typeof does not say undefined", () => notUndefined(value));
  attempt(name + ": or a size, told apart by in", () => orASize(value));
  attempt(name + ": or a string", () => orAString(value));
  attempt(name + ": or a thunk", () => orAThunk(value));
  attempt(name + ": or a list", () => orAList(value));
  attempt(name + ": or bytes", () => orBytes(value));
  attempt(name + ": or a boolean", () => orABoolean(value));
}
attempt("undefined", () => [orNothing(undefined), onlyIfAnObject(undefined), notUndefined(undefined)]);
