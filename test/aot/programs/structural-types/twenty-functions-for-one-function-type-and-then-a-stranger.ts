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

type Step = (n: number) => number;

const steps: Step[] = [
  n => n + 1,
  n => n + 2,
  n => n + 3,
  n => n * 2,
  n => n * 3,
  n => n - 1,
  n => n - 2,
  n => n / 2,
  n => n % 3,
  n => -n,
  n => n | 0,
  n => n >>> 1,
  n => n ** 2,
  n => n + 0.5,
  n => n * 0.5,
  n => n & 7,
  n => n ^ 1,
  n => n << 1,
  n => n >> 1,
  n => n + 20,
];

function apply(f: Step, n: number): number {
  return f(n);
}
function applyPlusOne(f: Step, n: number): number {
  return f(n) + 1;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += apply(steps[i % steps.length], i % 10);
show("2000 calls of the twenty", () => total);

class Scale {
  factor: number = 3;
  times(n: number): number {
    return n * this.factor;
  }
  static half(n: number): number {
    return n / 2;
  }
}
const scale = new Scale();
function withOptional(n: number, extra?: string): number {
  return extra === undefined ? n : extra.length;
}
function counting(n: number): number {
  return arguments.length;
}
const holder = { double: (n: number): number => n * 2, text: (n: number): string => "text " + n };
const returnsText: { f(n: number): number | string } = { f: holder.text };

const strangers: [string, Step][] = [
  ["Math.abs", Math.abs],
  ["Math.sqrt", Math.sqrt],
  ["Math.max", Math.max],
  ["Number", Number],
  ["bound built-in", Math.abs.bind(null)],
  ["bound method", scale.times.bind(scale)],
  ["unbound method", scale.times],
  ["static method", Scale.half],
  ["proxy", new Proxy(steps[0], {})],
  ["lying proxy", new Proxy(steps[0], { apply: () => "a string" })],
  ["hybrid", Object.assign((n: number) => n + 1000, { tag: "hybrid" })],
  ["with an optional parameter", withOptional],
  ["counting its arguments", counting],
  ["from eval", eval("(n) => n * 7")],
  ["from eval, returns a string", eval("(n) => 'evaluated ' + n")],
  ["from eval, not a function", eval("({})")],
  ["from eval, a class", eval("(class { constructor(n) { this.n = n; } })")],
  ["from Reflect.get", Reflect.get(holder, "double")],
  ["from Reflect.get, returns a string", Reflect.get(holder, "text")],
  ["from Reflect.get, missing", Reflect.get(holder, "missing")],
  ["one of the twenty", steps[3]],
];

for (const [label, f] of strangers) {
  show(label, () => apply(f, -4));
  show(label + " plus one", () => applyPlusOne(f, -4));
}
show("a method type that may return a string", () => returnsText.f(1));

total = 0;
for (let i = 0; i < 2000; i++) total += apply(steps[i % steps.length], i % 10);
show("2000 calls of the twenty again", () => total);
