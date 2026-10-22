const mark: unique symbol = Symbol("mark");

interface Runner {
  run(): string;
}

interface Walker {
  run(): string;
  pace: number;
}

class Athlete implements Runner, Walker {
  pace = 5;
  note?: string;
  spare?: number = 1;
  [mark]?: boolean;
  run(): string {
    return "runs at " + this.pace;
  }
}

function asClass(a: Athlete): string {
  return a.run();
}

function asRunner(r: Runner): string {
  return r.run();
}

function asWalker(w: Walker): string {
  return w.run() + " " + w.pace;
}

const states: [string, () => Athlete][] = [
  ["untouched", () => new Athlete()],
  [
    "an optional member added",
    () => {
      const a = new Athlete();
      a.note = "added";
      return a;
    },
  ],
  [
    "an optional field deleted",
    () => {
      const a = new Athlete();
      delete a.spare;
      return a;
    },
  ],
  [
    "a symbol key added",
    () => {
      const a = new Athlete();
      a[mark] = true;
      return a;
    },
  ],
  ["frozen", () => Object.freeze(new Athlete())],
  ["sealed", () => Object.seal(new Athlete())],
  ["not extensible", () => Object.preventExtensions(new Athlete())],
  [
    "a field redefined as an accessor",
    () => {
      const a = new Athlete();
      Object.defineProperty(a, "pace", { get: () => 6, configurable: true });
      return a;
    },
  ],
  [
    "the prototype of another object",
    () => {
      const a = new Athlete();
      Object.create(a);
      return a;
    },
  ],
  [
    "many members added and deleted",
    () => {
      const a = new Athlete();
      for (let i = 0; i < 40; i++) Reflect.set(a, "k" + i, i);
      for (let i = 0; i < 40; i++) Reflect.deleteProperty(a, "k" + i);
      return a;
    },
  ],
  ["a child of an instance", () => Object.create(new Athlete())],
];

const kept: [string, Athlete][] = states.map(([label, make]) => [label, make()]);

function round(label: string): void {
  for (const [state, a] of kept) console.log(label + ", " + state + ": " + a.run() + " | " + asClass(a) + " | " + asRunner(a) + " | " + asWalker(a));
}

let warm = 0;
for (let i = 0; i < 2000; i++) for (const [, a] of kept) warm += asClass(a).length + asRunner(a).length + asWalker(a).length;
console.log("2000 honest: " + warm);
round("before");
const written = Athlete.prototype.run;
Athlete.prototype.run = function () { return "RUNS AT " + this.pace; };
round("replaced");
Athlete.prototype.run = written;
round("put back");

export {};
