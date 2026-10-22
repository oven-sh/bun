function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + value;
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

class Sink {
  last: number = 0;
  all: number[] = [];
  reals: number[] = [0.5];
}

async function scaled(n: number, sink: Sink): Promise<string> {
  const before = typeof n;
  await null;
  const twice: number = n * 2;
  const next: number = n + 1;
  sink.last = n;
  sink.all.push(n);
  sink.reals.push(n);
  await null;
  return before + " -> " + text(n) + ", twice " + text(twice) + ", next " + text(next) + ", whole " + text(n | 0) + ", kept " + text(sink.last) + " " + text(sink.all[sink.all.length - 1]) + " " + text(sink.reals[sink.reals.length - 1]);
}

function* stepped(n: number, sink: Sink): Generator<string, string, void> {
  yield typeof n;
  const twice: number = n * 2;
  sink.last = n;
  sink.all.push(n);
  yield text(twice);
  return text(n) + ", next " + text(n + 1) + ", kept " + text(sink.last) + " " + text(sink.all[sink.all.length - 1]);
}

async function* streamed(n: number): AsyncGenerator<string, void, void> {
  yield typeof n;
  await null;
  yield text(n) + ", twice " + text(n * 2);
}

async function shouted(word: string): Promise<string> {
  await null;
  const length: number = word.length;
  await null;
  return text(word) + ", length " + text(length) + ", added " + text(word + "!");
}

async function chosen(on: boolean): Promise<string> {
  await null;
  return text(on) + ", " + (on ? "yes" : "no") + ", not " + text(!on);
}

const values: [string, unknown][] = [
  ["a whole number", 3],
  ["a fraction", 0.5],
  ["minus zero", -0],
  ["past 2 ** 31", 4294967296],
  ["a numeric text", "7"],
  ["a text", "text"],
  ["undefined", undefined],
  ["null", null],
  ["true", true],
  ["a bigint", 5n],
  ["a list", [4]],
  ["an object with valueOf", { valueOf: () => 9 }],
];

const sink = new Sink();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += (await scaled(i & 7, sink)).length;
console.log("2000 honest calls: " + warm);
sink.all.length = 0;
sink.reals.length = 1;

for (const [label, value] of values) {
  const promise: Promise<string> = Reflect.apply(scaled, undefined, [value, sink]);
  console.log("async, " + label + ": " + (await promise.catch(failure)));

  try {
    const walker: Generator<string, string, void> = Reflect.apply(stepped, undefined, [value, sink]);
    console.log("generator, " + label + ": " + [walker.next().value, walker.next().value, walker.next().value].join(" | "));
  } catch (error) {
    console.log("generator, " + label + ": " + failure(error));
  }

  try {
    const stream: AsyncGenerator<string, void, void> = Reflect.apply(streamed, undefined, [value]);
    const out: string[] = [];
    for await (const line of stream) out.push(line);
    console.log("async generator, " + label + ": " + out.join(" | "));
  } catch (error) {
    console.log("async generator, " + label + ": " + failure(error));
  }

  const word: Promise<string> = Reflect.apply(shouted, undefined, [value]);
  console.log("a string parameter, " + label + ": " + (await word.catch(failure)));
  const flag: Promise<string> = Reflect.apply(chosen, undefined, [value]);
  console.log("a boolean parameter, " + label + ": " + (await flag.catch(failure)));
}

console.log("the list of numbers: " + sink.all.map(text).join(" | "));
console.log("the list of reals: " + sink.reals.map(text).join(" | "));

const loose: (...given: never[]) => Promise<string> = scaled;
console.log("nothing at all: " + (await loose().catch(failure)));
console.log("honest again: " + (await scaled(2, new Sink())));

export {};
