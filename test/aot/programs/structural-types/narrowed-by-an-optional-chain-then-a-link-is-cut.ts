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
  weight: number | undefined = 7;
  grow(): number {
    return 8;
  }
}

class Twig {
  leaf: Leaf | undefined = new Leaf();
}

class Branch {
  twig: Twig | null = new Twig();
  run?: () => number = () => 4;
}

type Between = (b: Branch) => void;
const keep: Between = () => {};
const cutTwig: Between = b => {
  b.twig = null;
  delete b.run;
};
const cutLeaf: Between = b => {
  if (b.twig) b.twig.leaf = undefined;
};
const cutWeight: Between = b => {
  if (b.twig && b.twig.leaf) b.twig.leaf.weight = undefined;
};

const uses: [string, (b: Branch, between: Between) => unknown][] = [
  ["the chain is truthy", (b, between) => (b.twig?.leaf ? (between(b), b.twig.leaf.grow()) : "none")],
  ["the chain is not undefined", (b, between) => (b.twig?.leaf !== undefined ? (between(b), b.twig.leaf.grow()) : "none")],
  ["the end is not undefined", (b, between) => (b.twig?.leaf?.weight !== undefined ? (between(b), b.twig.leaf.weight + 1) : "none")],
  ["the end is a number", (b, between) => (typeof b.twig?.leaf?.weight === "number" ? (between(b), b.twig.leaf.weight + 1) : "none")],
  ["the end equals seven", (b, between) => (b.twig?.leaf?.weight === 7 ? (between(b), b.twig.leaf.weight) : "none")],
  ["the end is an instance", (b, between) => (b.twig?.leaf instanceof Leaf ? (between(b), b.twig.leaf.weight) : "none")],
  ["the middle after the end was tested", (b, between) => (b.twig?.leaf?.weight ? (between(b), b.twig.leaf) : "none")],
  ["an optional call", (b, between) => (b.run?.() === 4 ? (between(b), b.run()) : "none")],
  ["a chain after the change", (b, between) => (b.twig?.leaf ? (between(b), b.twig?.leaf?.weight) : "none")],
];

function round(label: string, between: Between): void {
  for (const [name, use] of uses) attempt(label + ": " + name, () => use(new Branch(), between));
}

round("honest", keep);
for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(new Branch(), keep);
round("the first link is cut", cutTwig);
round("the second link is cut", cutLeaf);
round("the end is cleared", cutWeight);
round("honest again", keep);
