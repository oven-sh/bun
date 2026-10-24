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

function kindOf(value: {}): string {
  return typeof value;
}

function keysOf(value: {}): string[] {
  return Object.keys(value);
}

function copyOf(value: {}): {} {
  return { ...value };
}

function jsonOf(value: {}): string | undefined {
  return JSON.stringify(value);
}

function textOf(value: {}): string {
  return value.toString();
}

function makerOf(value: {}): string {
  return value.constructor.name;
}

function owns(value: {}, key: string): boolean {
  return value.hasOwnProperty(key);
}

function isItself(value: {}): boolean {
  return value === value;
}

function isAnObject(value: {}): boolean {
  return value instanceof Object;
}

function boxedIsSame(value: {}): boolean {
  return Object(value) === value;
}

function passThrough<T extends {}>(value: T): T {
  const held: {} = value;
  return held === value ? value : value;
}

const values: [string, {}][] = [
  ["an empty literal", {}],
  ["a literal", { a: 1 }],
  ["0", 0],
  ["-0", -0],
  ["1.5", 1.5],
  ["NaN", NaN],
  ["2 ** 40", 2 ** 40],
  ["an empty string", ""],
  ["a string", "ab"],
  ["true", true],
  ["false", false],
  ["a symbol", Symbol("s")],
  ["0n", 0n],
  ["a large bigint", 2n ** 80n],
  ["a built-in function", Math.max],
  ["an array", [1, 2]],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = { a: i };
  warm += kindOf(honest).length + keysOf(honest).length + Object.keys(copyOf(honest)).length + (jsonOf(honest) ?? "").length + textOf(honest).length;
  warm += makerOf(honest).length + (owns(honest, "a") ? 1 : 0) + (isItself(honest) ? 1 : 0) + (isAnObject(honest) ? 1 : 0) + (boxedIsSame(honest) ? 1 : 0) + passThrough(honest).a;
}
console.log("after 2000 literals", warm);

for (const [name, value] of values) {
  attempt(name + ": typeof", () => kindOf(value));
  attempt(name + ": keys", () => keysOf(value));
  attempt(name + ": spread", () => copyOf(value));
  attempt(name + ": JSON", () => jsonOf(value));
  attempt(name + ": toString", () => textOf(value));
  attempt(name + ": constructor", () => makerOf(value));
  attempt(name + ": owns 0", () => owns(value, "0"));
  attempt(name + ": owns length", () => owns(value, "length"));
  attempt(name + ": equals itself", () => isItself(value));
  attempt(name + ": instanceof Object", () => isAnObject(value));
  attempt(name + ": Object(value) is the value", () => boxedIsSame(value));
  attempt(name + ": comes back", () => passThrough(value));
}
