interface Thing {
  x: number;
  y: number;
  m(): number;
}

const log: string[] = [];

class Real {
  x = 1;
  y = 2;
  m(): number {
    return this.x + this.y;
  }
}

class Accessors {
  get x(): number {
    log.push("get x");
    return 30;
  }
  set x(value: number) {
    log.push("set x " + value);
  }
  y = 40;
  m(): number {
    return -1;
  }
}

function forms(): [string, Thing][] {
  const wide = { a: "a", y: 6, m: () => 56, b: "b", x: 5 };
  return [
    ["a class instance", new Real()],
    ["a literal", { x: 1, y: 2, m() { return this.x * this.y; } }],
    ["another order", { m: () => 34, y: 4, x: 3 }],
    ["wider", wide],
    ["accessors of a class", new Accessors()],
    ["inherited", Object.create({ x: 7, y: 8, m: () => 78 })],
    ["a proxy", new Proxy(new Real(), {})],
    ["frozen", Object.freeze({ x: 9, y: 10, m: () => 910 })],
  ];
}

function attempt(body: () => unknown): string {
  try {
    return String(body());
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
}

let current: Thing = new Real();

const read = () => current.x * 100 + current.y;
const call = () => current.m();
const store = (value: number) => {
  current.x = value;
  return current.x;
};
const keys = () => Object.keys(current).join("");
const copy = () => JSON.stringify({ ...current });
const isReal = () => current instanceof Real;
const nested = () => () => () => current.y;

let warm = 0;
for (let i = 0; i < 2000; i++) warm += read() + call() + store(1) + keys().length;
console.log("2000 honest rounds: " + warm);

for (const [label, thing] of forms()) {
  current = thing;
  const line = [attempt(read), attempt(call), attempt(() => store(50)), attempt(read), attempt(keys), attempt(copy), attempt(isReal), attempt(() => nested()()())];
  console.log(label + ": " + line.join(" | ") + " [" + log.join() + "]");
  log.length = 0;
}

current = new Real();
console.log("honest again: " + read() + " " + call() + " " + keys());

function counter(start: Thing): { step: () => number; swap: (next: Thing) => void } {
  let held = start;
  return {
    step: () => held.m() + held.x,
    swap: next => {
      held = next;
    },
  };
}

const c = counter(new Real());
for (let i = 0; i < 2000; i++) c.step();
const steps: string[] = [];
for (const [, thing] of forms()) {
  c.swap(thing);
  steps.push(attempt(c.step));
}
console.log("a variable captured by two closures: " + steps.join());
log.length = 0;

const readers: (() => number)[] = [];
for (const [, thing] of forms()) readers.push(() => thing.x + thing.y);
console.log("one closure for each form: " + readers.map(r => r()).join());
log.length = 0;

let swapped: Thing = new Real();
const trace: number[] = [];
const peek = () => swapped.y;
for (let i = 0; i < 2004; i++) {
  if (i === 2001) swapped = { m: () => 0, y: -2, x: -1 };
  const y = peek();
  if (i >= 2000) trace.push(y);
}
console.log("reassigned in the middle of a loop: " + trace.join());

export {};
