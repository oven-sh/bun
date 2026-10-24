function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
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

interface Named {
  id: number;
  name: string;
}

function copyInto<T extends object>(target: T, source: T): void {
  for (const key in source) target[key] = source[key];
}

function describe(n: Named): string {
  return typeof n.id + " " + show(n.id) + ", " + typeof n.name + " " + show(n.name) + ", keys " + Object.keys(n).join() + ", " + JSON.stringify(n);
}

function report(title: string, n: Named): void {
  console.log(title + ": " + describe(n));
  attempt("  id + 1", () => n.id + 1);
  attempt("  name.length", () => n.name.length);
  attempt("  name.toUpperCase()", () => n.name.toUpperCase());
}

const honest: Named = { id: 1, name: "one" };
let total = 0;
for (let i = 0; i < 2000; i++) {
  copyInto(honest, { id: i, name: "n" + (i % 7) });
  total += honest.id + honest.name.length;
}
console.log("2000 honest copies: " + total);
report("honest", honest);

const target: Named = { id: 1, name: "one" };
const numbered = { id: 2, name: 77 };
copyInto<{ id: number }>(target, numbered);
report("the source's name is a number", target);

const second: Named = { id: 1, name: "one" };
const listed = { id: 3, name: ["a", "b"], extra: true };
const onlyId: { id: number } = listed;
copyInto(onlyId, onlyId);
copyInto<{ id: number }>(second, onlyId);
report("the source's name is a list and it has one member more", second);

const third: Named = { id: 1, name: "one" };
const textual = { name: "three", id: "3" };
const onlyName: { name: string } = textual;
copyInto<{ name: string }>(third, onlyName);
report("the source's id is a string", third);

class Base {
  id = 4;
}
class Wide extends Base {
  name = 4.5;
}
const fourth: Named = { id: 1, name: "one" };
copyInto<Base>(fourth, new Wide());
report("the source is an instance of a subclass", fourth);

const fifth: Named = { id: 1, name: "one" };
const inherited: { id: number } = Object.create({ id: 5, name: null });
copyInto<{ id: number }>(fifth, inherited);
report("the source inherits its members", fifth);

copyInto(target, { id: 9, name: "nine" });
report("honest again", target);

export {};
