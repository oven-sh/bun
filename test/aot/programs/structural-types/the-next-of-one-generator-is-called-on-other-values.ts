function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

function* numbers(): Generator<number, string, number> {
  const a: number = yield 1;
  const b: number = yield a + 1;
  return "end " + b;
}

function* words(): Generator<string, number, string> {
  const a: string = yield "one";
  const b: string = yield a + "!";
  return b.length;
}

async function* slow(): AsyncGenerator<number, void, void> {
  yield 1;
}

const receivers: [string, () => unknown][] = [
  ["another generator of the same function", numbers],
  ["a generator of another function", words],
  ["an async generator", slow],
  ["an array iterator", () => [1, 2].values()],
  ["a plain object", () => ({})],
  ["an object that inherits from a generator", () => Object.create(numbers())],
  ["a number", () => 5],
  ["undefined", () => undefined],
  ["null", () => null],
  ["the generator function", () => numbers],
];

const lender = numbers();
const next = lender.next;
const giveBack = lender.return;
const raise = lender.throw;

for (const [label, make] of receivers) {
  for (const [name, call] of [
    ["next", (receiver: unknown) => next.call(receiver, 10)],
    ["return", (receiver: unknown) => giveBack.call(receiver, "given back")],
    ["throw", (receiver: unknown) => raise.call(receiver, "raised")],
  ] satisfies [string, (receiver: unknown) => unknown][]) {
    try {
      console.log(name + " on " + label + ": " + text(call(make())));
    } catch (error) {
      console.log(name + " on " + label + ": " + failure(error));
    }
  }
}

console.log("the lender was never touched: " + text(lender.next(0)));

const detached = numbers().next;
try {
  console.log("a bare call: " + text(detached(1)));
} catch (error) {
  console.log("a bare call: " + failure(error));
}

const target = words();
const asNumbers: (this: unknown, sent: number) => IteratorResult<number, string> = next;
const first = asNumbers.call(target, 1);
const second = asNumbers.call(target, 2);
const third = asNumbers.call(target, 3);
console.log("typed as numbers, really words: " + text(first) + " " + text(second) + " " + text(third));
if (!first.done) console.log("the first value plus one: " + text(first.value + 1));
if (third.done) {
  try {
    console.log("the end's length: " + text(third.value.length));
  } catch (error) {
    console.log("the end's length: " + failure(error));
  }
}

const asyncNext = slow().next;
for (const [label, make] of receivers.slice(0, 5)) {
  try {
    const result: unknown = asyncNext.call(make());
    console.log("async next on " + label + ": a promise " + (result instanceof Promise) + ", " + (await Promise.resolve(result).then(text, failure)));
  } catch (error) {
    console.log("async next on " + label + ": at once " + failure(error));
  }
}

export {};
