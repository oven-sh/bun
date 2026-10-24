function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Point {
  x: number = 1;
  y: number = 2;
  sum(): number {
    return this.x + this.y;
  }
}

const cache = new Map<number, Cached>();
class Cached {
  id: number;
  hits: number = 0;
  constructor(id: number) {
    this.id = id;
    const found = cache.get(id);
    if (found !== undefined) {
      found.hits++;
      return found;
    }
    cache.set(id, this);
  }
}

class Literal {
  x: number = 1;
  label: string = "literal class";
  constructor(swap: boolean) {
    if (swap) return { label: "stand-in", x: 50 };
  }
}

class Base {
  base: number = 1;
  constructor(other?: Base) {
    if (other !== undefined) return other;
  }
}
class Stamps extends Base {
  stamp: number = 7;
  #hidden: number = 8;
  static hidden(o: Stamps): number {
    return o.#hidden;
  }
  static has(o: object): boolean {
    return #hidden in o;
  }
}

show("first", () => new Cached(1));
show("second with the same id", () => new Cached(1));
show("same object", () => new Cached(1) === cache.get(1));
show("hits", () => cache.get(1)?.hits);
show("another id", () => new Cached(2).hits);

const honest = new Literal(false);
const swapped = new Literal(true);
show("honest", () => honest);
show("swapped", () => swapped);
show("swapped x + 1", () => swapped.x + 1);
show("swapped label", () => swapped.label.toUpperCase());
show("swapped instanceof", () => swapped instanceof Literal);
show("swapped keys", () => Object.keys(swapped).join());
show("honest keys", () => Object.keys(honest).join());

function xOf(l: Literal): number {
  return l.x;
}
let sum = 0;
for (let i = 0; i < 2000; i++) sum += xOf(honest);
show("2000 honest reads", () => sum);
show("then the stand-in", () => xOf(swapped));

const target = new Base();
const stamped = new Stamps(target);
show("the subclass's fields land on the other object", () => target);
show("what new returned is that object", () => stamped === target);
show("instanceof Stamps", () => stamped instanceof Stamps);
show("stamp", () => stamped.stamp);
show("private name", () => Stamps.hidden(stamped));
show("has the private name", () => Stamps.has(target));
show("stamping twice", () => new Stamps(target));
show("a plain one", () => new Stamps());

const point = new Point();
const stampedPoint = new Stamps(Object.assign(point, { base: 2 }));
show("a point is stamped", () => point);
show("keys", () => Object.keys(point).join());
show("sum still works", () => point.sum());
show("stamp of the point", () => stampedPoint.stamp);
