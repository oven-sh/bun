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

class Steady {
  leaf: Leaf | null = new Leaf();
  count: number | undefined = 3;
  name: string | null = "name";
  run: (() => number) | undefined = () => 4;
}

class Flicker {
  reads = 0;
  get leaf(): Leaf | null {
    return this.reads++ % 2 === 0 ? new Leaf() : null;
  }
  get count(): number | undefined {
    return this.reads++ % 2 === 0 ? 3 : undefined;
  }
  get name(): string | null {
    return this.reads++ % 2 === 0 ? "name" : null;
  }
  get run(): (() => number) | undefined {
    return this.reads++ % 2 === 0 ? () => 4 : undefined;
  }
}

interface Source {
  readonly leaf: Leaf | null;
  readonly count: number | undefined;
  readonly name: string | null;
  readonly run: (() => number) | undefined;
}

const uses: [string, (o: Source) => unknown][] = [
  ["if, a field", o => {
    if (o.leaf) return o.leaf.weight;
    return "none";
  }],
  ["and, a field", o => o.leaf && o.leaf.weight],
  ["conditional, a field", o => (o.leaf ? o.leaf.weight : "none")],
  ["not, a field", o => (!o.leaf ? "none" : o.leaf.weight)],
  ["or, a field", o => !o.leaf || o.leaf.weight],
  ["a number, plus one", o => (o.count ? o.count + 1 : "none")],
  ["a number, to fixed", o => (o.count ? o.count.toFixed(1) : "none")],
  ["a number, read", o => (o.count ? o.count : "none")],
  ["a string, its length", o => (o.name ? o.name.length : "none")],
  ["a string, read", o => (o.name ? o.name : "none")],
  ["a string, added to", o => (o.name ? o.name + "!" : "none")],
  ["a function, called", o => (o.run ? o.run() : "none")],
  ["a function, and called", o => o.run && o.run()],
  ["a loop", o => {
    let total = 0;
    let turns = 0;
    while (o.leaf && turns++ < 3) total += o.leaf === null ? 100 : o.leaf.weight;
    return total;
  }],
];

for (const [name, use] of uses) attempt("steady " + name, () => use(new Steady()));
for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(new Steady());
for (const [name, use] of uses) attempt("alternating " + name, () => use(new Flicker()));
for (const [name, use] of uses) attempt("steady again " + name, () => use(new Steady()));
