function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Fixed {
  get size(): number {
    return 5;
  }
}

class Child extends Fixed {}

class Counted {
  static get size(): number {
    return 5;
  }
}

function literal() {
  return {
    get size(): number {
      return 5;
    },
  };
}

type Loose = { size: number };

const stores: [string, (o: Loose) => unknown][] = [
  ["a store", o => (o.size = 6)],
  ["plus equals", o => (o.size += 1)],
  ["increment", o => o.size++],
  ["or equals, which stores nothing", o => (o.size ||= 6)],
  ["and equals", o => (o.size &&= 6)],
  ["nullish equals, which stores nothing", o => (o.size ??= 6)],
  ["a destructuring store", o => ([o.size] = [6])],
  ["Object.assign", o => Object.assign(o, { size: 6 }).size],
  ["Reflect.set", o => Reflect.set(o, "size", 6)],
  ["Object.defineProperty", o => Object.defineProperty(o, "size", { value: 6 }).size],
];

const makers: [string, () => Loose][] = [
  ["a class", () => new Fixed()],
  ["a subclass", () => new Child()],
  ["a literal", literal],
  ["a static member", () => Counted],
  ["a plain object", () => ({ size: 5 })],
];

for (const [kind, make] of makers) {
  for (const [name, store] of stores) {
    if (kind === "a static member" && name === "Object.defineProperty") continue;
    attempt(kind + ": " + name, () => {
      const o = make();
      let result: unknown;
      try {
        result = store(o);
      } finally {
        console.log("  afterwards: " + text(o.size) + ", own: " + Object.hasOwn(o, "size"));
      }
      return result;
    });
  }
}
let sum = 0;
const mixed: Loose[] = [];
for (let i = 0; i < 2000; i++) mixed.push({ size: i });
mixed.push(new Fixed());
let threw = 0;
for (const o of mixed) {
  try {
    o.size += 1;
  } catch {
    threw++;
  }
  sum += o.size;
}
console.log("2000 plain objects and one with only a getter: " + sum + ", threw " + threw);
