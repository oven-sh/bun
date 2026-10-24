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

type Tagged = { readonly [Symbol.toStringTag]: string };
type Convertible = { [Symbol.toPrimitive](hint: string): symbol | number | string };
type Walkable = { [Symbol.iterator](): Iterator<string> };

function tagOf(value: Tagged): string {
  return value[Symbol.toStringTag];
}

function tagLength(value: Tagged): number {
  return value[Symbol.toStringTag].length;
}

function kindOfTagged(value: Tagged): string {
  return typeof value;
}

function ownsTag(value: Tagged): boolean {
  return Object.hasOwn(value, Symbol.toStringTag);
}

function converted(value: Convertible): string {
  return typeof value[Symbol.toPrimitive]("default");
}

function convertedAsNumber(value: Convertible): string {
  return typeof value[Symbol.toPrimitive]("number");
}

function kindOfConvertible(value: Convertible): string {
  return typeof value;
}

function firstStep(value: Walkable): string | undefined {
  const step = value[Symbol.iterator]().next();
  return step.done ? undefined : step.value;
}

function iteratorName(value: Walkable): string {
  return value[Symbol.iterator].name;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const tagged: Tagged = { [Symbol.toStringTag]: "Honest" + i };
  const convertible: Convertible = { [Symbol.toPrimitive]: hint => hint.length + i };
  warm += tagOf(tagged).length + tagLength(tagged) + kindOfTagged(tagged).length + (ownsTag(tagged) ? 1 : 0);
  warm += converted(convertible).length + convertedAsNumber(convertible).length + kindOfConvertible(convertible).length + (firstStep(["a"]) ?? "").length + iteratorName(["a"]).length;
}
console.log("after 2000 honest objects", warm);

const tagged: [string, Tagged][] = [
  ["a literal", { [Symbol.toStringTag]: "Literal" }],
  ["a symbol", Symbol("s")],
  ["a bigint", 5n],
  ["a large bigint", 2n ** 70n],
  ["a map", new Map()],
  ["a promise", Promise.resolve(1)],
  ["a typed array", new Uint8Array(1)],
  ["a buffer of bytes", new ArrayBuffer(1)],
  ["a generator", (function* () {})()],
  ["Math", Math],
  ["JSON", JSON],
];
for (const [name, value] of tagged) {
  attempt(name + ": tag", () => tagOf(value));
  attempt(name + ": length of the tag", () => tagLength(value));
  attempt(name + ": typeof", () => kindOfTagged(value));
  attempt(name + ": own", () => ownsTag(value));
  attempt(name + ": Object.prototype.toString", () => Object.prototype.toString.call(value));
}

const convertibles: [string, Convertible][] = [
  ["a literal", { [Symbol.toPrimitive]: hint => hint }],
  ["a symbol", Symbol("s")],
  ["a registered symbol", Symbol.for("s")],
  ["a date", new Date(0)],
];
for (const [name, value] of convertibles) {
  attempt(name + ": converted by default", () => converted(value));
  attempt(name + ": converted to a number", () => convertedAsNumber(value));
  attempt(name + ": typeof", () => kindOfConvertible(value));
  attempt(name + ": an unknown hint", () => typeof value[Symbol.toPrimitive]("nonsense"));
}

const walkables: [string, Walkable][] = [
  ["an array", ["x", "y"]],
  ["a string", "xy"],
  ["an empty string", ""],
  ["a set", new Set(["x"])],
];
for (const [name, value] of walkables) {
  attempt(name + ": first step", () => firstStep(value));
  attempt(name + ": name of the iterator method", () => iteratorName(value));
  attempt(name + ": typeof", () => typeof value);
}
