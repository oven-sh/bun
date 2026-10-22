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

class Leaf {
  weight = 7;
}

class Plain {
  name: string | null = null;
  leaf: Leaf | undefined = undefined;
  count: number | null = null;
}

class Forgets {
  stores: string[] = [];
  get name(): string | null {
    return null;
  }
  set name(v: string | null) {
    this.stores.push("name");
  }
  get leaf(): Leaf | undefined {
    return undefined;
  }
  set leaf(v: Leaf | undefined) {
    this.stores.push("leaf");
  }
  get count(): number | null {
    return null;
  }
  set count(v: number | null) {
    this.stores.push("count");
  }
}

class Alternates {
  reads = 0;
  get name(): string | null {
    return this.reads++ % 2 === 0 ? null : "second";
  }
  set name(v: string | null) {}
  get leaf(): Leaf | undefined {
    return this.reads++ % 2 === 0 ? undefined : new Leaf();
  }
  set leaf(v: Leaf | undefined) {}
  get count(): number | null {
    return this.reads++ % 2 === 0 ? null : 2;
  }
  set count(v: number | null) {}
}

type Target = { name: string | null; leaf: Leaf | undefined; count: number | null };

const uses: [string, (o: Target) => unknown][] = [
  ["a default for a string", o => (o.name ?? "none").length],
  ["a default for a number", o => (o.count ?? 10) + 1],
  ["a default for an object", o => (o.leaf ?? new Leaf()).weight],
  ["assigned if missing, then its length", o => {
    o.name ??= "filled";
    return o.name.length;
  }],
  ["assigned if missing, then plus one", o => {
    o.count ??= 10;
    return o.count + 1;
  }],
  ["assigned if missing, then a field", o => {
    o.leaf ??= new Leaf();
    return o.leaf.weight;
  }],
  ["the value of the assignment", o => (o.name ??= "filled").length],
  ["assigned if falsy, then its length", o => {
    o.name ||= "filled";
    return o.name.length;
  }],
  ["assigned, then read", o => {
    o.count = 5;
    return [o.count, o.count + 1];
  }],
  ["tested against null through a default", o => ((o.name ?? null) !== null ? typeof o.name : "missing")],
];

for (const [name, use] of uses) attempt("plain: " + name, () => use(new Plain()));
for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(new Plain());
for (const [name, use] of uses) attempt("a setter that forgets: " + name, () => use(new Forgets()));
for (const [name, use] of uses) attempt("a getter that alternates: " + name, () => use(new Alternates()));
for (const [name, use] of uses) attempt("plain again: " + name, () => use(new Plain()));
