interface Gauge {
  level: number;
  name: string;
}

const log: string[] = [];

const writeOnly: Gauge = {
  set level(value: number) {
    log.push("set " + value);
  },
  name: "write only",
};

class Sink {
  name = "sink";
  set level(value: number) {
    log.push("sink set " + value);
  }
}

function flush(label: string, value: unknown): void {
  console.log(label + ": " + String(value) + " [" + log.join() + "]");
  log.length = 0;
}

function attempt(label: string, body: () => unknown): void {
  try {
    flush(label, body());
  } catch (error) {
    flush(label, "threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function level(g: Gauge): number {
  return g.level;
}

function plusOne(g: Gauge): number {
  return g.level + 1;
}

function asInteger(g: Gauge): number {
  return g.level | 0;
}

function fixed(g: Gauge): string {
  return g.level.toFixed(1);
}

function raise(g: Gauge): number {
  g.level += 5;
  return g.level;
}

function increment(g: Gauge): number {
  return g.level++;
}

function set(g: Gauge, value: number): number {
  return (g.level = value);
}

const table: [string, Gauge][] = [
  ["plain", { level: 1, name: "plain" }],
  ["an own setter", writeOnly],
  ["a setter of a class", new Sink()],
];

for (const [label, g] of table) {
  attempt(label + ", read", () => level(g));
  attempt(label + ", typeof", () => typeof level(g));
  attempt(label + ", plus one", () => plusOne(g));
  attempt(label + ", as an integer", () => asInteger(g));
  attempt(label + ", a method of the number", () => fixed(g));
  attempt(label + ", compound store", () => raise(g));
  attempt(label + ", increment", () => increment(g));
  attempt(label + ", the value of a store", () => set(g, 9));
  attempt(label + ", compared", () => level(g) === undefined);
  attempt(label + ", in", () => "level" in g);
  attempt(label + ", own", () => Object.hasOwn(g, "level"));
  attempt(label + ", keys", () => Object.keys(g).join());
  attempt(label + ", json", () => JSON.stringify(g));
  attempt(label + ", spread", () => {
    const copy = { ...g };
    return JSON.stringify(copy) + " " + ("level" in copy) + " " + copy.level;
  });
  attempt(label + ", default in a pattern", () => (({ level = -1 }: Partial<Gauge>) => level)(g));
}

const numbers: number[] = table.map(row => row[1].level);
console.log("collected into a number array: " + numbers.map(n => typeof n).join() + " " + JSON.stringify(numbers));
let sum = 0;
for (const n of numbers) sum += n;
console.log("summed: " + sum);

const plain: Gauge = { level: 1, name: "plain" };
let total = 0;
for (let i = 0; i < 2000; i++) total += plusOne(plain) + asInteger(plain);
console.log("2000 honest: " + total);
attempt("then the write-only one", () => plusOne(writeOnly) + " " + asInteger(writeOnly));
attempt("then plain", () => plusOne(plain) + " " + asInteger(plain));

export {};
