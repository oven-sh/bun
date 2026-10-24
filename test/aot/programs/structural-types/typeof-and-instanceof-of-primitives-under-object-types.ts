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

function kind(item: HasLength): string {
  return typeof item;
}

function isObject(item: HasLength): boolean {
  return typeof item === "object";
}

function isNotObject(item: HasLength): boolean {
  return typeof item !== "object";
}

function isString(item: HasLength): boolean {
  return typeof item === "string";
}

function isFunction(item: HasLength): boolean {
  return typeof item === "function";
}

function sorted(item: HasLength): string {
  switch (typeof item) {
    case "object":
      return "an object of " + item.length;
    case "function":
      return "a function of " + item.length;
    case "string":
      return "a string";
    default:
      return "something else";
  }
}

function isInstance(item: HasLength): boolean {
  return item instanceof Object;
}

function isArrayInstance(item: HasLength): boolean {
  return item instanceof Array;
}

function isStringInstance(item: HasLength): boolean {
  return item instanceof String;
}

function isArray(item: HasLength): boolean {
  return Array.isArray(item);
}

function tag(item: HasLength): string {
  return Object.prototype.toString.call(item);
}

function maker(item: HasLength): string {
  return item.constructor.name;
}

function objectOrElse(item: HasLength | undefined): string {
  if (typeof item === "object") return "object";
  if (typeof item === "undefined") return "undefined";
  return "unexpected " + typeof item;
}

const values: [string, HasLength][] = [
  ["literal", { length: 1 }],
  ["string", "a"],
  ["empty string", ""],
  ["array", [1]],
  ["function", kind],
  ["class", class {}],
  ["typed array", new Uint8Array(1)],
  ["String object", new String("a")],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = { length: i };
  warm += kind(honest).length + (isObject(honest) ? 1 : 0) + (isNotObject(honest) ? 1 : 0) + (isString(honest) ? 1 : 0) + (isFunction(honest) ? 1 : 0);
  warm += sorted(honest).length + (isInstance(honest) ? 1 : 0) + (isArrayInstance(honest) ? 1 : 0) + (isStringInstance(honest) ? 1 : 0) + (isArray(honest) ? 1 : 0);
  warm += tag(honest).length + maker(honest).length + objectOrElse(honest).length;
}
console.log("after 2000 literals", warm);

for (const [name, value] of values) {
  attempt(name + ": typeof", () => kind(value));
  attempt(name + ": typeof is object", () => isObject(value));
  attempt(name + ": typeof is not object", () => isNotObject(value));
  attempt(name + ": typeof is string", () => isString(value));
  attempt(name + ": typeof is function", () => isFunction(value));
  attempt(name + ": switch on typeof", () => sorted(value));
  attempt(name + ": instanceof Object", () => isInstance(value));
  attempt(name + ": instanceof Array", () => isArrayInstance(value));
  attempt(name + ": instanceof String", () => isStringInstance(value));
  attempt(name + ": Array.isArray", () => isArray(value));
  attempt(name + ": tag", () => tag(value));
  attempt(name + ": constructor", () => maker(value));
  attempt(name + ": object, undefined or unexpected", () => objectOrElse(value));
}

function kindOfAnything(value: {}): string {
  return typeof value;
}
function numberOrElse(value: { toFixed(digits: number): string }): string {
  return typeof value === "number" ? "number " + (value + 1) : "object " + value.toFixed(0);
}
for (const value of [1, 1.5, "s", true, 1n, Symbol.iterator, kindOfAnything, {}, []] satisfies {}[]) attempt("typeof anything", () => kindOfAnything(value));
attempt("a number told apart by typeof", () => [numberOrElse(1), numberOrElse(0.5), numberOrElse(new Number(2)), numberOrElse({ toFixed: () => "own" })]);
