interface Point {
  x: number;
  y: number;
  z?: number;
}

class Pair {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

function nameOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

function state(p: Point): string {
  return p.x + "," + p.y + "," + p.z + " " + Object.keys(p).join("") + " " + JSON.stringify(p);
}

async function readTwice(p: Point, gate: Promise<void>): Promise<string> {
  const before = state(p);
  await gate;
  return before + " -> " + state(p);
}

async function storeAfter(p: Point, gate: Promise<void>): Promise<string> {
  p.x = 10;
  await gate;
  try {
    p.x = 20;
    p.z = 30;
    return "stored " + state(p);
  } catch (error) {
    return "threw " + nameOf(error) + " " + state(p);
  }
}

async function callAfter(p: Pair, gate: Promise<void>): Promise<string> {
  const before = p.sum() + " " + (p instanceof Pair);
  await gate;
  return before + " -> " + p.sum() + " " + (p instanceof Pair);
}

function* steps(p: Point): Generator<string, string, void> {
  yield state(p);
  yield state(p);
  try {
    p.y = 99;
  } catch (error) {
    return "threw " + nameOf(error);
  }
  return state(p);
}

const changes: [string, (p: Point) => void][] = [
  ["nothing", () => {}],
  ["a store", p => { p.x = -1; }],
  ["an optional member added", p => { p.z = 3; }],
  ["a getter defined", p => { Object.defineProperty(p, "x", { get: () => 77, enumerable: true, configurable: true }); }],
  ["frozen", p => { Object.freeze(p); }],
  ["members deleted and added in another order", p => {
    const { x, y } = p;
    Reflect.deleteProperty(p, "x");
    Reflect.deleteProperty(p, "y");
    Object.assign(p, { y, x });
  }],
  ["a member moved to a new prototype", p => {
    Reflect.deleteProperty(p, "y");
    Object.setPrototypeOf(p, { y: 55 });
  }],
];

for (const [label, change] of changes) {
  let open: () => void = () => {};
  const gate = new Promise<void>(resolve => {
    open = resolve;
  });
  const a: Point = { x: 1, y: 2 };
  const b: Point = { x: 1, y: 2 };
  const reading = readTwice(a, gate);
  const storing = storeAfter(b, gate);
  change(a);
  change(b);
  open();
  console.log(label + ", read across an await: " + (await reading));
  console.log(label + ", stored across an await: " + (await storing));

  const c: Point = { x: 1, y: 2 };
  const generator = steps(c);
  const first = generator.next().value;
  change(c);
  console.log(label + ", across yields: " + first + " -> " + generator.next().value + " -> " + generator.next().value);
}

const pairChanges: [string, (p: Pair) => void][] = [
  ["nothing", () => {}],
  ["an own method", p => { p.sum = () => -1; }],
  ["another prototype", p => { Object.setPrototypeOf(p, { sum: () => -2 }); }],
  ["the class's method replaced", () => { Pair.prototype.sum = () => -3; }],
];

for (const [label, change] of pairChanges) {
  let open: () => void = () => {};
  const gate = new Promise<void>(resolve => {
    open = resolve;
  });
  const p = new Pair();
  const calling = callAfter(p, gate);
  change(p);
  open();
  console.log(label + ", called across an await: " + (await calling));
}

export {};
