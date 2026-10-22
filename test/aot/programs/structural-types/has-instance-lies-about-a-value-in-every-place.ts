class Plain {
  name = "plain";
}

class Fancy extends Plain {
  size = 3;
  grow(): number {
    return ++this.size;
  }
  static [Symbol.hasInstance](value: unknown): boolean {
    return value instanceof Plain;
  }
}

class Holder {
  constructor(public item: Plain) {}
  ask(): string {
    if (this.item instanceof Fancy) return typeof this.item.size + " " + this.item.size;
    return "plain";
  }
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function byParameter(p: Plain): string {
  return p instanceof Fancy ? typeof p.size + " " + p.size : "plain";
}

function byElement(list: Plain[]): string {
  const seen: string[] = [];
  for (const each of list) seen.push(each instanceof Fancy ? typeof each.size + " " + each.size : "plain");
  return seen.join();
}

function byResult(make: () => Plain): string {
  const made = make();
  return made instanceof Fancy ? typeof made.size + " " + made.size : "plain";
}

function callIt(p: Plain): string {
  return p instanceof Fancy ? "grew to " + p.grow() : "plain";
}

function storeIt(p: Plain): string {
  if (p instanceof Fancy) {
    p.size = 8;
    return Object.keys(p).join() + " " + JSON.stringify(p);
  }
  return "plain";
}

function addIt(p: Plain): number {
  return p instanceof Fancy ? p.size + 1 : -1;
}

function onlyFancy(list: Plain[]): string {
  const fancy = list.filter(each => each instanceof Fancy);
  return fancy.length + " " + fancy.map(each => typeof each.size).join();
}

const honest = new Fancy();
const liar = new Plain();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += byParameter(honest).length + byElement([honest]).length + addIt(honest) + new Holder(honest).ask().length;
console.log("2000 honest: " + warm);

for (const [label, value] of [
  ["honest", honest],
  ["a plain one", liar],
] satisfies [string, Plain][]) {
  const captured = (): string => (value instanceof Fancy ? typeof value.size + " " + value.size : "plain");
  attempt(label + ", a local", () => {
    const local: Plain = value;
    return local instanceof Fancy ? typeof local.size + " " + local.size : "plain";
  });
  attempt(label + ", a parameter", () => byParameter(value));
  attempt(label + ", a field", () => new Holder(value).ask());
  attempt(label + ", an element", () => byElement([value, value]));
  attempt(label + ", a result", () => byResult(() => value));
  attempt(label + ", captured", captured);
  attempt(label + ", plus one", () => addIt(value));
  attempt(label + ", a method is called", () => callIt(value));
  attempt(label + ", filtered", () => onlyFancy([value]));
}
attempt("a plain one, stored to", () => storeIt(new Plain()));
attempt("honest, stored to", () => storeIt(new Fancy()));
attempt("honest at the end", () => byParameter(honest) + " " + callIt(honest));

export {};
