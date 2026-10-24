function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

class Summary {
  count: number;
  label: string;
  constructor(count: number, label: string) {
    this.count = count;
    this.label = label;
  }
  describe(): string {
    return this.label + " x" + this.count;
  }
}

function* parts(): Generator<number, Summary, void> {
  yield 1;
  yield 2;
  return new Summary(2, "parts");
}

function* sameKind(): Generator<number, number, void> {
  yield 1;
  yield 2;
  return 100;
}

const seen: number[] = [];
for (const n of parts()) seen.push(n);
console.log("for-of: " + text(seen));
console.log("spread: " + text([...parts()]));
console.log("Array.from: " + text(Array.from(parts())));

const [a, b, c] = parts();
console.log("destructuring: " + text(a) + ", " + text(b) + ", " + text(c));
console.log("the third plus one: " + text(c + 1));
try {
  console.log("the third, toFixed: " + c.toFixed(1));
} catch (error) {
  console.log("the third, toFixed: " + failure(error));
}

function* wrapper(): Generator<number, string, void> {
  const summary: Summary = yield* parts();
  console.log("yield* gave " + text(summary) + " " + (summary instanceof Summary));
  return summary.describe();
}
console.log("wrapper, spread: " + text([...wrapper()]));
const w = wrapper();
console.log(text(w.next()) + " " + text(w.next()) + " " + text(w.next()) + " " + text(w.next()));

function* twoLevels(): Generator<number, number, void> {
  const first: string = yield* wrapper();
  const second: string = yield* wrapper();
  return first.length + second.length;
}
const t = twoLevels();
let step = t.next();
const trail: string[] = [];
while (!step.done) {
  trail.push(String(step.value));
  step = t.next();
}
console.log("two levels: " + trail.join() + " then " + text(step.value));

function* overAnArray(): Generator<number, string, void> {
  const result = yield* [7, 8];
  return "an array gives " + text(result);
}
console.log(text([...overAnArray()]));
const o = overAnArray();
o.next();
o.next();
console.log(text(o.next()));

function sumByHand(generator: Generator<number, number, void>): number {
  let sum = 0;
  for (;;) {
    const result = generator.next();
    sum += result.value;
    if (result.done) return sum;
  }
}
function sumByLoop(generator: Generator<number, number, void>): number {
  let sum = 0;
  for (const n of generator) sum += n;
  return sum;
}
console.log("by hand the return value counts: " + sumByHand(sameKind()));
console.log("by for-of it does not: " + sumByLoop(sameKind()));

function* noReturn(): Generator<number, void, void> {
  yield 1;
}
function* asksForIt(): Generator<number, string, void> {
  const nothing: void = yield* noReturn();
  return "void is " + text(nothing);
}
console.log(text([...asksForIt()]));
const n = asksForIt();
n.next();
console.log(text(n.next()));
