function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

class Dog {
  legs = 4;
  name = "rex";
  toys: number[] = [1, 2];
  friend: Dog | null = null;
  speak: () => number = () => 1;
  bark(): number {
    return this.legs * 2;
  }
  title(): string {
    return this.name.toUpperCase();
  }
  count(): number {
    let sum = 0;
    for (const toy of this.toys) sum += toy;
    return sum;
  }
  say(): number {
    return this.speak() + 1;
  }
}

function read(d: Dog): unknown[] {
  const results: unknown[] = [];
  for (const use of [() => d.legs + 1, () => d.bark(), () => d.title(), () => d.count(), () => d.say(), () => Object.keys(d).join()]) {
    try {
      results.push(use());
    } catch (error) {
      results.push(error instanceof Error ? error.constructor.name : "other");
    }
  }
  return results;
}

attempt("honest", () => read(new Dog()));
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const d = new Dog();
  d.legs = i;
  warm += d.bark() + d.title().length + d.count() + d.say();
}
console.log("2000 honest rounds", warm);

const wrong = { legs: "many", name: 7, toys: "12", speak: null };

const writers: [string, (d: Dog) => void][] = [
  ["Reflect.set", d => { for (const [key, value] of Object.entries(wrong)) Reflect.set(d, key, value); }],
  ["Object.assign", d => { Object.assign(d, wrong); }],
  ["Object.defineProperty with values", d => { for (const [key, value] of Object.entries(wrong)) Object.defineProperty(d, key, { value, writable: true, enumerable: true, configurable: true }); }],
  ["Object.defineProperty with getters", d => { for (const [key, value] of Object.entries(wrong)) Object.defineProperty(d, key, { get: () => (log.push("get-" + key), value), enumerable: true, configurable: true }); }],
  ["Object.defineProperties", d => { Object.defineProperties(d, { legs: { value: "many" }, name: { value: 7 } }); }],
  ["Reflect.defineProperty", d => { Reflect.defineProperty(d, "legs", { value: null }); }],
  ["Reflect.deleteProperty", d => { for (const key of Object.keys(wrong)) Reflect.deleteProperty(d, key); }],
  ["Object.setPrototypeOf to a literal", d => { Object.setPrototypeOf(d, { bark: () => "other bark", title: () => 5, count: () => null, say: () => undefined }); }],
  ["Object.setPrototypeOf to null", d => { Object.setPrototypeOf(d, null); }],
  ["Reflect.setPrototypeOf", d => { Reflect.setPrototypeOf(d, Array.prototype); }],
  ["Object.freeze, then typed stores", d => { Object.freeze(d); }],
  ["an own member over the method", d => { Object.assign(d, { bark: () => "own bark" }); }],
  ["a copy from entries", d => { Object.assign(d, Object.fromEntries(Object.entries(wrong))); }],
];

for (const [name, write] of writers) {
  attempt(name, () => {
    const d = new Dog();
    write(d);
    return read(d);
  });
  attempt(name + ", after honest uses of the same dog", () => {
    const d = new Dog();
    let sum = 0;
    for (let i = 0; i < 100; i++) sum += d.bark() + d.count();
    write(d);
    return [sum, ...read(d)];
  });
  attempt(name + ", then a typed store", () => {
    const d = new Dog();
    write(d);
    d.legs = 8;
    d.name = "again";
    return read(d);
  });
}

attempt("elements: Reflect.set", () => {
  const list = [1, 2, 3];
  Reflect.set(list, 1, "two");
  Reflect.set(list, "length", 2);
  return [list, list.map(n => n + 1)];
});
attempt("elements: Object.assign", () => {
  const list = [1, 2, 3];
  Object.assign(list, ["a", "b"]);
  return [list, list.reduce((a, b) => a + b, 0)];
});
attempt("elements: Object.defineProperty", () => {
  const list = [1, 2, 3];
  Object.defineProperty(list, 0, { get: () => (log.push("get-0"), "zero") });
  return [list[0], list[0] + 1, list.length];
});
attempt("a literal", () => {
  const p = { x: 1, y: 2 };
  Reflect.set(p, "x", "one");
  Object.assign(p, { y: null });
  return [p.x + 1, p.y + 1, JSON.stringify(p)];
});
attempt("a captured literal", () => {
  const p = { n: 1 };
  const next = () => p.n + 1;
  const before = next();
  Reflect.set(p, "n", "text");
  return [before, next()];
});
attempt("honest again", () => read(new Dog()));
