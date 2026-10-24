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

interface Ordered<T> {
  compare(other: T): number;
}

class Meters implements Ordered<Meters> {
  constructor(public amount: number) {}
  compare(other: Meters): number {
    return this.amount - other.amount;
  }
}

class Words implements Ordered<Words> {
  constructor(public text: string) {}
  compare(other: Words): number {
    return this.text.length - other.text.length;
  }
}

function largest<T extends Ordered<T>>(list: T[]): T {
  let best = list[0];
  for (let i = 1; i < list.length; i++) if (list[i].compare(best) > 0) best = list[i];
  return best;
}

function sorted<T extends Ordered<T>>(list: T[]): T[] {
  return [...list].sort((a, b) => a.compare(b));
}

class Point {
  x = 1;
  same(other: this): boolean {
    return this.x === other.x;
  }
  copy(): this {
    return this;
  }
}

class Point3 extends Point {
  z = 3;
  same(other: this): boolean {
    return super.same(other) && this.z.toFixed(0) === other.z.toFixed(0);
  }
}

class Chain {
  steps: string[] = [];
  add(step: string): this {
    this.steps.push(step);
    return this;
  }
}

class LoudChain extends Chain {
  shout(): this {
    this.steps = this.steps.map(s => s.toUpperCase());
    return this;
  }
}

attempt("honest", () => [largest([new Meters(1), new Meters(3), new Meters(2)]).amount, largest([new Words("a"), new Words("abc")]).text, sorted([new Meters(2), new Meters(1)]).map(m => m.amount), new Point().same(new Point()), new Point3().same(new Point3()), new LoudChain().add("a").shout().add("b").steps]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += largest([new Meters(i), new Meters(1)]).amount + largest([new Words("a"), new Words("ab")]).text.length + (new Point3().same(new Point3()) ? 1 : 0);
console.log("2000 honest rounds", warm);

attempt("meters and words in one list of things that compare with anything", () => {
  const meters: Ordered<Meters>[] = [new Meters(1)];
  const loose: Ordered<never>[] = [new Meters(1), new Words("abc")];
  return [meters.length, loose.length];
});
attempt("a method parameter is compared both ways", () => {
  const asMeters: Ordered<Meters> = new Meters(1);
  const wide: Ordered<Meters | Words> = asMeters;
  return wide.compare(new Words("abc"));
});
attempt("a method parameter is compared both ways: words get meters", () => {
  const asWords: Ordered<Words> = new Words("abc");
  const wide: Ordered<Meters | Words> = asWords;
  return wide.compare(new Meters(1));
});
attempt("a parameter of type this: the base is given to the subclass", () => {
  const p: Point = new Point3();
  return p.same(new Point());
});
attempt("a parameter of type this: honest through the base type", () => {
  const p: Point = new Point3();
  return p.same(new Point3());
});
attempt("an empty list", () => largest<Meters>([]));
attempt("an empty list, then a field", () => largest<Meters>([]).amount);
attempt("a literal that compares", () => {
  const literal: Ordered<Meters> & { amount: number } = { amount: 100, compare: () => 1 };
  const list: (Ordered<Meters> & { amount: number })[] = [new Meters(5), literal];
  let best = list[0];
  for (const item of list) if (item.compare(new Meters(0)) > 0) best = item;
  return best.amount;
});
attempt("compare answers something odd", () => {
  class Odd implements Ordered<Odd> {
    constructor(public n: number) {}
    compare(other: Odd): number {
      return this.n === other.n ? -0 : NaN;
    }
  }
  return [largest([new Odd(1), new Odd(2)]).n, sorted([new Odd(2), new Odd(1)]).map(o => o.n)];
});
attempt("this as a result, taken off the object", () => {
  const add = new Chain().add;
  return add("lost");
});
attempt("honest again", () => [largest([new Meters(1), new Meters(3)]).amount, new Point3().same(new Point3())]);
