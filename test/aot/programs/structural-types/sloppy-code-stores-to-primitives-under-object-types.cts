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

function setLength(item: HasLength, size: number): number {
  item.length = size;
  return item.length;
}

function increment(item: HasLength): number {
  item.length++;
  return item.length;
}

function rename(item: { name: string }): string {
  item.name = "renamed";
  return item.name;
}

function forget(item: { length?: number }): boolean {
  return delete item.length;
}

function addMember(value: {}): unknown {
  const open: { extra?: number } = value;
  open.extra = 1;
  return open.extra;
}

function kindOfThis(this: HasLength): string {
  return typeof this;
}

function lengthOfThis(this: HasLength): number {
  return this.length;
}

function thisIsTheValue(this: HasLength, value: HasLength): boolean {
  return this === value;
}

function storeToThis(this: HasLength): number {
  this.length = 1;
  return this.length;
}

console.log("sloppy", (function (this: unknown) { return this !== undefined; })());

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = { length: i };
  warm += setLength(honest, 1) + increment(honest) + rename({ name: "n" }).length + (forget({ length: i }) ? 1 : 0) + kindOfThis.call(honest).length + lengthOfThis.call(honest) + storeToThis.call(honest);
}
console.log("after 2000 literals", warm);

const makers: [string, () => HasLength][] = [
  ["literal", () => ({ length: 5 })],
  ["string", () => "hello"],
  ["empty string", () => ""],
  ["array", () => [1, 2, 3, 4, 5]],
  ["function", () => function (a: number) { return a; }],
  ["typed array", () => new Uint8Array(5)],
  ["String object", () => new String("boxed")],
];
for (const [name, make] of makers) {
  attempt(name + ": store 2", () => setLength(make(), 2));
  attempt(name + ": ++", () => increment(make()));
  attempt(name + ": delete", () => forget(make()));
  attempt(name + ": a new member", () => addMember(make()));
  attempt(name + ": typeof this", () => kindOfThis.call(make()));
  attempt(name + ": length of this", () => lengthOfThis.call(make()));
  attempt(name + ": this is the value", () => {
    const value = make();
    return thisIsTheValue.call(value, value);
  });
  attempt(name + ": a store to this", () => storeToThis.call(make()));
}
attempt("rename a function", () => rename(function old() {}));
attempt("rename a class", () => rename(class Old {}));
attempt("a new member on a number, a boolean, a symbol, a bigint", () => [addMember(5), addMember(true), addMember(Symbol("s")), addMember(5n)]);
