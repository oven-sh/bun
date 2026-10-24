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

interface Options {
  size?: number;
  label?: string;
}

function sizeOf(options: Options): number {
  return options.size ?? -1;
}

function labelOf(options: Options): string {
  return options.label === undefined ? "no label" : options.label;
}

function twiceTheSize(options: Options): number {
  return options.size === undefined ? 0 : options.size * 2;
}

function kindOf(options: Options): string {
  return typeof options;
}

function setSize(options: Options, size: number): number | undefined {
  options.size = size;
  return options.size;
}

function dropSize(options: Options): boolean {
  return delete options.size;
}

function hasSize(options: Options): boolean {
  return "size" in options;
}

function merged(options: Options): Options {
  return { size: 1, label: "default", ...options };
}

function forgetful(value: {}): Options {
  return value;
}

const values: [string, Options][] = [
  ["an empty literal", {}],
  ["a full literal", { size: 4, label: "full" }],
  ["a number", forgetful(5)],
  ["zero", forgetful(0)],
  ["a string", forgetful("text")],
  ["an empty string", forgetful("")],
  ["false", forgetful(false)],
  ["a symbol", forgetful(Symbol("s"))],
  ["a bigint", forgetful(3n)],
  ["a set, whose size is inherited", forgetful(new Set([1, 2, 3]))],
  ["a literal whose size is a string", forgetful({ size: "large" })],
  ["a function", forgetful(sizeOf)],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest: Options = i % 2 === 0 ? { size: i } : { size: i, label: "l" };
  warm += sizeOf(honest) + labelOf(honest).length + twiceTheSize(honest) + kindOf(honest).length + (setSize(honest, 1) ?? 0) + (hasSize(honest) ? 1 : 0);
  warm += (dropSize(honest) ? 1 : 0) + Object.keys(merged(honest)).length;
}
console.log("after 2000 literals", warm);

for (const [name, value] of values) {
  attempt(name + ": size", () => sizeOf(value));
  attempt(name + ": label", () => labelOf(value));
  attempt(name + ": twice the size", () => twiceTheSize(value));
  attempt(name + ": typeof", () => kindOf(value));
  attempt(name + ": in", () => hasSize(value));
  attempt(name + ": merged over defaults", () => merged(value));
  attempt(name + ": delete", () => dropSize(value));
  attempt(name + ": store", () => setSize(value, 9));
}

function optionalLength(item: { length?: number }): number {
  return item.length ?? -1;
}
function optionalName(item: { name?: string }): string {
  return item.name ?? "nameless";
}
function optionalMethod(item: { toFixed?(digits: number): string }): string {
  return item.toFixed?.(1) ?? "no method";
}
attempt("optional length of a literal", () => [optionalLength({}), optionalLength({ length: 2 })]);
attempt("optional length of a string", () => [optionalLength("abc"), optionalLength("")]);
const asFunction: Function = optionalLength;
const asClass: Function = class Thing {};
attempt("optional length of an array and a function", () => [optionalLength([1]), optionalLength(asFunction)]);
attempt("optional name of a function", () => [optionalName({}), optionalName(asFunction), optionalName(asClass)]);
attempt("optional method of a number", () => [optionalMethod({}), optionalMethod(2.25), optionalMethod(0), optionalMethod({ toFixed: () => "own" })]);
