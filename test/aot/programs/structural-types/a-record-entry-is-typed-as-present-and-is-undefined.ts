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

class Animal {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

class Dog extends Animal {
  legs = 4;
  tag = "dog tag";
  owner = { id: 7 };
  bark(): string {
    return this.name + " barks on " + this.legs;
  }
}

class Cat extends Animal {
  lives = "nine";
  indoor = true;
  purr(): string {
    return this.name + " purrs";
  }
}

function countOf(counts: Record<string, number>, key: string): number {
  return counts[key];
}

function countPlusOne(counts: Record<string, number>, key: string): number {
  return counts[key] + 1;
}

function kindOf(counts: Record<string, number>, key: string): string {
  return typeof counts[key];
}

function bump(counts: Record<string, number>, key: string): number {
  counts[key]++;
  return counts[key];
}

function bumpOrStart(counts: Record<string, number>, key: string): number {
  counts[key] = (counts[key] || 0) + 1;
  return counts[key];
}

function legsOf(dogs: Record<string, Dog>, key: string): number {
  return dogs[key].legs;
}

function lengthOf(texts: { [key: string]: string }, key: string): number {
  return texts[key].length;
}

function byNumber(names: Record<number, string>, id: number): string {
  return names[id] + "!";
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const counts: Record<string, number> = { a: i, b: 0.5 };
  warm += countOf(counts, "a") + countPlusOne(counts, "b") + kindOf(counts, "a").length + bump(counts, "a") + bumpOrStart(counts, "b");
  warm += legsOf({ rex: new Dog("rex") }, "rex") + lengthOf({ a: "text" }, "a") + byNumber({ 1: "one" }, 1).length;
}
console.log("after 2000 reads of entries that are there", warm);

const keys = ["a", "missing", "", "constructor", "toString", "__proto__", "hasOwnProperty", "valueOf", "0", "length"];
for (const key of keys) {
  const make = (): Record<string, number> => ({ a: 1 });
  attempt(show(key) + ": read", () => typeof countOf(make(), key) === "function" ? "a function" : typeof countOf(make(), key) === "object" ? "an object" : countOf(make(), key));
  attempt(show(key) + ": typeof", () => kindOf(make(), key));
  attempt(show(key) + ": + 1 is a", () => typeof countPlusOne(make(), key));
  attempt(show(key) + ": ++", () => bump(make(), key));
  attempt(show(key) + ": start or bump", () => typeof bumpOrStart(make(), key));
  attempt(show(key) + ": in, own", () => [key in make(), Object.hasOwn(make(), key)]);
}
attempt("legs of a dog that is not there", () => legsOf({ rex: new Dog("rex") }, "fido"));
attempt("legs of the constructor", () => legsOf({ rex: new Dog("rex") }, "constructor"));
attempt("length of a text that is not there", () => lengthOf({ a: "text" }, "b"));
attempt("length of toString", () => lengthOf({ a: "text" }, "toString"));
attempt("a name by a number that is not there", () => byNumber({ 1: "one" }, 2));
attempt("deleted", () => {
  const counts: Record<string, number> = { a: 1, b: 2 };
  delete counts.a;
  return [countOf(counts, "a"), countPlusOne(counts, "a"), Object.keys(counts)];
});
attempt("a record without a prototype", () => {
  const counts: Record<string, number> = Object.create(null);
  counts.a = 1;
  return [countOf(counts, "a"), countOf(counts, "constructor"), kindOf(counts, "toString"), Object.keys(counts)];
});
attempt("words are counted", () => {
  const counts: Record<string, number> = {};
  for (const word of ["a", "b", "a", "constructor", "a", "constructor"]) bumpOrStart(counts, word);
  return [Object.keys(counts), counts.a, typeof counts.constructor];
});
attempt("a union of keys where one was never stored", () => {
  const sizes: Partial<Record<"small" | "large", number>> = { small: 1 };
  const full: Record<"small", number> & Partial<Record<"large", number>> = { small: 1, ...sizes };
  return [full.small, full.large, (full.large ?? 0) + 1];
});
attempt("a literal becomes a record and forgotten members are listed", () => {
  const wide = { a: 1, b: "text" };
  const narrow: { a: number } = wide;
  const record: Record<string, number> = narrow;
  let total = 0;
  for (const value of Object.values(record)) total += value;
  return [total, countPlusOne(record, "b")];
});
