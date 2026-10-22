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

function kindOf(value: Object): string {
  return typeof value;
}

function textOf(value: Object): string {
  return value.toString();
}

function localTextOf(value: Object): string {
  return typeof value.toLocaleString();
}

function unwrapped(value: Object): string {
  return typeof value.valueOf();
}

function unwrapsToItself(value: Object): boolean {
  return value.valueOf() === value;
}

function owns(value: Object, key: PropertyKey): boolean {
  return value.hasOwnProperty(key);
}

function lists(value: Object, key: PropertyKey): boolean {
  return value.propertyIsEnumerable(key);
}

function isParentOf(value: Object, child: Object): boolean {
  return value.isPrototypeOf(child);
}

function madeBy(value: Object): Function {
  return value.constructor;
}

class Wrapper {
  held: Object;
  constructor(held: Object) {
    this.held = held;
  }
  kind(): string {
    return typeof this.held;
  }
  text(): string {
    return this.held.toString();
  }
}

const values: [string, Object][] = [
  ["a literal", { a: 1 }],
  ["3", 3],
  ["-0", -0],
  ["0.25", 0.25],
  ["NaN", NaN],
  ["a string", "ab"],
  ["an empty string", ""],
  ["false", false],
  ["a symbol", Symbol("s")],
  ["a bigint", 9n],
  ["a built-in function", Math.max],
  ["an array", ["x"]],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest: Object = { a: i };
  warm += kindOf(honest).length + textOf(honest).length + localTextOf(honest).length + unwrapped(honest).length + (unwrapsToItself(honest) ? 1 : 0);
  warm += (owns(honest, "a") ? 1 : 0) + (lists(honest, "a") ? 1 : 0) + (isParentOf(honest, honest) ? 1 : 0) + madeBy(honest).name.length + new Wrapper(honest).kind().length;
}
console.log("after 2000 literals", warm);

for (const [name, value] of values) {
  attempt(name + ": typeof", () => kindOf(value));
  attempt(name + ": toString", () => textOf(value));
  attempt(name + ": typeof toLocaleString()", () => localTextOf(value));
  attempt(name + ": typeof valueOf()", () => unwrapped(value));
  attempt(name + ": valueOf() is the value", () => unwrapsToItself(value));
  attempt(name + ": owns 0, length, a", () => [owns(value, 0), owns(value, "length"), owns(value, "a")]);
  attempt(name + ": lists 0, length, a", () => [lists(value, 0), lists(value, "length"), lists(value, "a")]);
  attempt(name + ": is the prototype of an object", () => isParentOf(value, {}));
  attempt(name + ": constructor", () => madeBy(value));
  attempt(name + ": in a field", () => {
    const wrapper = new Wrapper(value);
    return [wrapper.kind(), wrapper.text(), wrapper.held === value || value !== value];
  });
}
