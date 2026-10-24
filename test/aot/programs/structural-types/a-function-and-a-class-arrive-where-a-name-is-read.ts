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

type Named = { name: string };

class Person {
  constructor(public name: string) {}
}

class WithAStaticName {
  static name = "chosen";
}

class WithAStaticGetter {
  static reads = 0;
  static get name(): string {
    WithAStaticGetter.reads++;
    return "computed " + WithAStaticGetter.reads;
  }
}

function nameOf(item: Named): string {
  return item.name;
}

function greeting(item: Named): string {
  let text = "";
  for (let i = 0; i < 2; i++) text += "hello " + item.name + ";";
  return text;
}

function lengthOfName(item: Named): number {
  return item.name.length;
}

function kindOf(item: Named): string {
  return typeof item;
}

function ownsName(item: Named): boolean {
  return Object.hasOwn(item, "name");
}

function keysOf(item: Named): string[] {
  return Object.keys(item);
}

function copy(item: Named): Named {
  return { ...item };
}

function declared() {}
const arrow = () => {};
const bound = declared.bind(null);

const values: [string, Named][] = [
  ["a literal", { name: "literal" }],
  ["a person", new Person("Ada")],
  ["a declared function", declared],
  ["an arrow function", arrow],
  ["an anonymous function", (() => function () {})()],
  ["a bound function", bound],
  ["a method", { method() {} }.method],
  ["a getter's function", Object.getOwnPropertyDescriptor(WithAStaticGetter, "name")?.get ?? declared],
  ["a class", Person],
  ["an anonymous class", (() => class {})()],
  ["a class with a static name", WithAStaticName],
  ["a class with a static getter", WithAStaticGetter],
  ["a built-in function", Math.max],
  ["a built-in class", Map],
  ["an error", new TypeError("message")],
  ["an async function", async function later() {}],
  ["a generator function", function* steps() {}],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = { name: "n" + i };
  warm += nameOf(honest).length + greeting(honest).length + lengthOfName(honest) + kindOf(honest).length + (ownsName(honest) ? 1 : 0) + keysOf(honest).length + copy(honest).name.length;
}
console.log("after 2000 literals", warm);

for (const [label, value] of values) {
  attempt(label + ": name", () => nameOf(value));
  attempt(label + ": greeting", () => greeting(value));
  attempt(label + ": length", () => lengthOfName(value));
  attempt(label + ": typeof", () => kindOf(value));
  attempt(label + ": own", () => ownsName(value));
  attempt(label + ": keys", () => keysOf(value));
  attempt(label + ": spread", () => copy(value));
  attempt(label + ": the name of the spread", () => copy(value).name);
}
console.log("reads of the static getter", WithAStaticGetter.reads);
