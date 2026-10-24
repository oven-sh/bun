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

type HasPrototype = { prototype: {} };

class Thing {
  method(): void {}
}

function kindOfPrototype(item: HasPrototype): string {
  return typeof item.prototype;
}

function keysOfPrototype(item: HasPrototype): string[] {
  return Object.getOwnPropertyNames(item.prototype);
}

function pointsBack(item: HasPrototype): boolean {
  return item.prototype.constructor === item;
}

function textOfPrototype(item: HasPrototype): string {
  return item.prototype.toString();
}

function ownsPrototype(item: HasPrototype): boolean {
  return Object.hasOwn(item, "prototype");
}

function declared(): void {}
const asFunction = (value: Function): HasPrototype => value;

const values: [string, HasPrototype][] = [
  ["a literal", { prototype: { a: 1 } }],
  ["a class", Thing],
  ["a declared function", declared],
  ["an arrow function", asFunction(() => {})],
  ["a bound function", asFunction(declared.bind(null))],
  ["a method", asFunction(new Thing().method)],
  ["an async function", asFunction(async () => {})],
  ["a generator function", asFunction(function* () {})],
  ["a built-in function", asFunction(Math.max)],
  ["a built-in class", Map],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = { prototype: { i } };
  warm += kindOfPrototype(honest).length + keysOfPrototype(honest).length + (pointsBack(honest) ? 1 : 0) + textOfPrototype(honest).length + (ownsPrototype(honest) ? 1 : 0);
}
console.log("after 2000 literals", warm);

for (const [name, value] of values) {
  attempt(name + ": typeof the prototype", () => kindOfPrototype(value));
  attempt(name + ": names in the prototype", () => keysOfPrototype(value).slice(0, 3));
  attempt(name + ": its constructor points back", () => pointsBack(value));
  attempt(name + ": text of the prototype", () => textOfPrototype(value));
  attempt(name + ": own", () => ownsPrototype(value));
}
