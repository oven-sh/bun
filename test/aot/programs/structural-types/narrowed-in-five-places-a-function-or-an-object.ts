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

class Task {
  cost = 3;
  run(): number {
    return this.cost;
  }
}

type Work = (() => number) | Task;

class Slot {
  work: Work = () => 1;
}

type Between = (s: Slot) => void;
const keep: Between = () => {};
const toTask: Between = s => {
  s.work = new Task();
};
const toFunction: Between = s => {
  s.work = () => 2;
};

function call(f: () => number): number {
  return f();
}

function costOf(t: Task): number {
  return t.cost;
}

const asFunction: [string, (s: Slot, between: Between) => unknown][] = [
  ["read", (s, between) => (typeof s.work === "function" ? (between(s), typeof s.work) : "other")],
  ["called", (s, between) => (typeof s.work === "function" ? (between(s), s.work()) : "other")],
  ["handed on", (s, between) => (typeof s.work === "function" ? (between(s), call(s.work)) : "other")],
  ["its length", (s, between) => (typeof s.work === "function" ? (between(s), s.work.length) : "other")],
  ["through call", (s, between) => (typeof s.work === "function" ? (between(s), s.work.call(undefined)) : "other")],
  ["by exclusion", (s, between) => (!(s.work instanceof Task) ? (between(s), s.work()) : "other")],
];

const asTask: [string, (s: Slot, between: Between) => unknown][] = [
  ["read", (s, between) => (typeof s.work === "object" ? (between(s), typeof s.work) : "other")],
  ["a field", (s, between) => (typeof s.work === "object" ? (between(s), s.work.cost) : "other")],
  ["a method", (s, between) => (typeof s.work === "object" ? (between(s), s.work.run()) : "other")],
  ["handed on", (s, between) => (typeof s.work === "object" ? (between(s), costOf(s.work)) : "other")],
  ["by instanceof", (s, between) => (s.work instanceof Task ? (between(s), s.work.cost) : "other")],
  ["by exclusion", (s, between) => (typeof s.work !== "function" ? (between(s), s.work.cost) : "other")],
  ["by in", (s, between) => ("cost" in s.work ? (between(s), s.work.cost) : "other")],
];

function withTask(): Slot {
  const s = new Slot();
  s.work = new Task();
  return s;
}

function inACapturedVariable(really: boolean): unknown {
  let w: Work = () => 1;
  const change = (): void => {
    if (really) w = new Task();
  };
  if (typeof w === "function") {
    change();
    return w();
  }
  return "other";
}

function inAnElement(works: Work[], really: boolean): unknown {
  const change = (): void => {
    if (really) works[0] = new Task();
  };
  if (typeof works[0] === "function") {
    change();
    return works[0]();
  }
  return "other";
}

function round(label: string, first: Between, second: Between, really: boolean): void {
  for (const [name, use] of asFunction) attempt(label + " a function, " + name, () => use(new Slot(), first));
  for (const [name, use] of asTask) attempt(label + " an object, " + name, () => use(withTask(), second));
  attempt(label + " in a captured variable", () => inACapturedVariable(really));
  attempt(label + " in an element", () => inAnElement([() => 1], really));
}

round("honest", keep, keep, false);
let rounds = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of asFunction) use(new Slot(), keep);
  for (const [, use] of asTask) use(withTask(), keep);
  inACapturedVariable(false);
  inAnElement([() => 1], false);
  rounds++;
}
console.log("honest rounds: " + rounds);
round("replaced", toTask, toFunction, true);
round("honest again", keep, keep, false);
