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
  heavier(): number {
    return this.weight + 1;
  }
}

class Branch {
  leaf: Leaf | null = new Leaf();
  spare: Leaf | undefined = new Leaf();
  extra?: Leaf = new Leaf();
}

type Between = (b: Branch) => void;
const keep: Between = () => {};
const clear: Between = b => {
  b.leaf = null;
  b.spare = undefined;
  delete b.extra;
};

function weightOf(l: Leaf): number {
  return l.weight;
}

const uses: [string, (b: Branch, between: Between) => unknown][] = [
  ["not null, read", (b, between) => (b.leaf !== null ? (between(b), b.leaf) : "none")],
  ["not null, a field", (b, between) => (b.leaf !== null ? (between(b), b.leaf.weight) : "none")],
  ["not null, a method", (b, between) => (b.leaf !== null ? (between(b), b.leaf.heavier()) : "none")],
  ["not null, handed on", (b, between) => (b.leaf !== null ? (between(b), weightOf(b.leaf)) : "none")],
  ["truthy, a field", (b, between) => (b.leaf ? (between(b), b.leaf.weight) : "none")],
  ["loosely not null, a field", (b, between) => (b.leaf != null ? (between(b), b.leaf.weight) : "none")],
  ["not undefined, read", (b, between) => (b.spare !== undefined ? (between(b), b.spare) : "none")],
  ["not undefined, a field", (b, between) => (b.spare !== undefined ? (between(b), b.spare.weight) : "none")],
  ["typeof object, a field", (b, between) => (typeof b.spare === "object" ? (between(b), b.spare.weight) : "none")],
  ["instanceof, a field", (b, between) => (b.spare instanceof Leaf ? (between(b), b.spare.weight) : "none")],
  ["optional, read", (b, between) => (b.extra ? (between(b), b.extra) : "none")],
  ["optional, a field", (b, between) => (b.extra ? (between(b), b.extra.weight) : "none")],
  ["optional, still there", (b, between) => (b.extra ? (between(b), "extra" in b) : "none")],
  ["a store to a field of it", (b, between) => (b.leaf !== null ? (between(b), (b.leaf.weight = 9)) : "none")],
];

class Owner {
  own: Leaf | null = new Leaf();
  change(really: boolean): void {
    if (really) this.own = null;
  }
  inItsOwnField(really: boolean): unknown {
    if (this.own !== null) {
      this.change(really);
      return this.own.weight;
    }
    return "none";
  }
}

function inAnElement(leaves: (Leaf | null)[], really: boolean): unknown {
  const change = (): void => {
    if (really) leaves[0] = null;
  };
  if (leaves[0] !== null) {
    change();
    return leaves[0].weight;
  }
  return "none";
}

function inACapturedVariable(really: boolean): unknown {
  let l: Leaf | null = new Leaf();
  const change = (): void => {
    if (really) l = null;
  };
  if (l !== null) {
    change();
    return l.weight;
  }
  return "none";
}

function round(label: string, between: Between, really: boolean): void {
  for (const [name, use] of uses) attempt(label + " in a parameter, " + name, () => use(new Branch(), between));
  attempt(label + " in its own field", () => new Owner().inItsOwnField(really));
  attempt(label + " in an element", () => inAnElement([new Leaf()], really));
  attempt(label + " in a captured variable", () => inACapturedVariable(really));
}

round("honest", keep, false);
let rounds = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) use(new Branch(), keep);
  new Owner().inItsOwnField(false);
  inAnElement([new Leaf()], false);
  inACapturedVariable(false);
  rounds++;
}
console.log("honest rounds: " + rounds);
round("cleared", clear, true);
round("honest again", keep, false);
