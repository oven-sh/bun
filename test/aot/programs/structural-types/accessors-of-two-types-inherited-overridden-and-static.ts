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

const log: string[] = [];

class Base {
  kept = 1;
  get size(): number {
    log.push("base get");
    return this.kept;
  }
  set size(value: number | string) {
    log.push("base set " + typeof value);
    this.kept = typeof value === "string" ? value.length : value;
  }
  grow(): number {
    this.size = "grown";
    return this.size;
  }
}

class Inherits extends Base {}

class CallsSuper extends Base {
  get size(): number {
    log.push("child get");
    return super.size * 10;
  }
  set size(value: number | string) {
    log.push("child set " + typeof value);
    super.size = typeof value === "string" ? value + value : value + 1;
  }
}

class WiderStill extends Base {
  get size(): number {
    return super.size;
  }
  set size(value: number | string | boolean) {
    super.size = typeof value === "boolean" ? (value ? 100 : 0) : value;
  }
}

class Counter {
  static kept = 1;
  static get size(): number {
    return Counter.kept;
  }
  static set size(value: number | string) {
    Counter.kept = typeof value === "string" ? value.length : value;
  }
}

class SubCounter extends Counter {}

function logged(label: string, run: () => unknown): void {
  log.length = 0;
  attempt(label, run);
  if (log.length > 0) console.log("  " + log.join(", "));
}

function fill(b: Base, value: number | string): unknown {
  b.size = value;
  return [b.size, b.size + 1, b.kept];
}

const makers: [string, () => Base][] = [
  ["the base", () => new Base()],
  ["a subclass that inherits both", () => new Inherits()],
  ["a subclass that calls super", () => new CallsSuper()],
  ["a subclass with a wider setter", () => new WiderStill()],
];

for (const [name, make] of makers) {
  logged(name + ": a number", () => fill(make(), 4));
  logged(name + ": a string", () => fill(make(), "four"));
  logged(name + ": plus equals", () => {
    const b = make();
    b.size += 1;
    return [b.size, b.kept];
  });
  logged(name + ": a method of the base stores a string", () => make().grow());
  logged(name + ": own keys", () => Object.keys(make()).join());
}
logged("the wider setter takes a boolean", () => {
  const w = new WiderStill();
  w.size = true;
  return [w.size, w.kept];
});
logged("static: a string", () => {
  Counter.size = "four";
  return [Counter.size, Counter.size + 1, Counter.kept];
});
logged("static: plus equals", () => {
  Counter.size += 1;
  return [Counter.size, Counter.kept];
});
logged("static, through the subclass", () => {
  SubCounter.size = "sub";
  return [SubCounter.size, Counter.size, Counter.kept, Object.keys(SubCounter).join()];
});
let sum = 0;
const shared: Base[] = [new Base(), new Inherits(), new CallsSuper(), new WiderStill()];
for (let i = 0; i < 2000; i++) {
  const b = shared[i % 4];
  b.size = i % 3 === 0 ? "abc" : i;
  sum += b.size;
}
console.log("2000 rounds: " + sum);
