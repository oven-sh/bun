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

const uses: [string, (item: HasLength) => unknown][] = [
  ["in", item => "length" in item],
  ["in with an index", item => 0 in item],
  ["Reflect.has", item => Reflect.has(item, "length")],
  ["Reflect.get", item => Reflect.get(item, "length")],
  ["Reflect.ownKeys", item => Reflect.ownKeys(item).length],
  ["Reflect.getPrototypeOf", item => Reflect.getPrototypeOf(item) === null],
  ["Reflect.isExtensible", item => Reflect.isExtensible(item)],
  ["Reflect.getOwnPropertyDescriptor", item => Reflect.getOwnPropertyDescriptor(item, "length")?.writable],
  ["Object.getPrototypeOf", item => Object.getPrototypeOf(item) === null],
  ["Object.getOwnPropertyNames", item => Object.getOwnPropertyNames(item)],
  ["Object.getOwnPropertyDescriptor", item => Object.getOwnPropertyDescriptor(item, "length")?.writable],
  ["Object.isFrozen", item => Object.isFrozen(item)],
  ["Object.isSealed", item => Object.isSealed(item)],
  ["Object.isExtensible", item => Object.isExtensible(item)],
  ["Object.freeze", item => Object.freeze(item) === item],
  ["Object.preventExtensions", item => Object.preventExtensions(item) === item],
  ["Object.entries", item => Object.entries(item)],
  ["Object.values", item => Object.values(item)],
  ["Object.hasOwn", item => Object.hasOwn(item, "length")],
  ["Object.create", item => typeof Object.create(item)],
  ["Object.setPrototypeOf", item => Object.setPrototypeOf(item, null) === item],
  ["Object.defineProperty", item => Object.defineProperty(item, "extra", { value: 1 }) === item],
  ["Object.assign from it", item => Object.assign({}, item)],
  ["new Proxy", item => new Proxy(item, {}).length],
  ["new WeakRef", item => new WeakRef(item).deref() === item],
  ["structuredClone", item => structuredClone(item)],
];

const makers: [string, () => HasLength][] = [
  ["literal", () => ({ length: 2 })],
  ["string", () => "ab"],
  ["empty string", () => ""],
  ["array", () => [7, 8]],
  ["String object", () => new String("ab")],
];

for (const [use, run] of uses) {
  for (let i = 0; i < 200; i++) run({ length: i });
  for (const [name, make] of makers) attempt(use + " of a " + name, () => run(make()));
}

function lengthIsIn(item: HasLength): boolean {
  return "length" in item;
}
function guardedRead(item: HasLength | { size: number }): number {
  if ("length" in item) return item.length;
  return item.size;
}
let warm = 0;
for (let i = 0; i < 2000; i++) warm += (lengthIsIn({ length: i }) ? 1 : 0) + guardedRead({ length: 1 }) + guardedRead({ size: 2 });
console.log("after 2000 literals", warm);
attempt("in, after 2000 literals, of a string", () => lengthIsIn("abc"));
attempt("in, after 2000 literals, of a function", () => lengthIsIn(lengthIsIn));
attempt("a read guarded by in, of a string", () => guardedRead("abc"));
attempt("a read guarded by in, of an array", () => guardedRead([1]));
attempt("in, of a literal again", () => lengthIsIn({ length: 0 }));
