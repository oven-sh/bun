function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

const table: number[] = [1, 2];
const holes: number[] = new Array<number>(3);
const record: Record<string, number> = { one: 1 };
const words: string[] = ["a"];

function* short(): Generator<number, void, void> {
  yield 1;
}
const spent: Iterator<number> = short();
spent.next();
spent.next();

class Sink {
  last: number = 0;
  all: number[] = [];
  reals: Float64Array = new Float64Array(1);
}
const sink = new Sink();

function use(n: number): string {
  const read = (): number => n;
  const next = (): number => n + 1;
  sink.last = n;
  sink.all.push(n);
  sink.reals[0] = n;
  let fixed: string;
  try {
    fixed = n.toFixed(1);
  } catch (error) {
    fixed = failure(error);
  }
  return text(n) + ", captured " + text(read()) + ", next " + text(next()) + ", whole " + text(n | 0) + ", field " + text(sink.last) + ", element " + text(sink.all[sink.all.length - 1]) + ", real " + text(sink.reals[0]) + ", " + fixed;
}

function pastTheEnd(n: number = table[9]): string {
  return use(n);
}
function fromAHole(n: number = holes[1]): string {
  return use(n);
}
function missingKey(n: number = record["missing"]): string {
  return use(n);
}
function parsedText(n: number = JSON.parse('"text"')): string {
  return use(n);
}
function parsedNull(n: number = JSON.parse("null")): string {
  return use(n);
}
function afterTheEnd(n: number = spent.next().value): string {
  return use(n);
}
function reflected(n: number = Reflect.get(record, "nothing")): string {
  return use(n);
}
function honest(n: number = table[1]): string {
  return use(n);
}
function fromAPattern({ n = table[9] }: { n?: number } = {}): string {
  return use(n);
}
function fromAnArrayPattern([n = holes[0]]: number[] = []): string {
  return use(n);
}
function chained(a: number = table[9], b: number = a): string {
  return use(b);
}
function word(w: string = words[5]): string {
  const read = (): string => w;
  let length: string;
  try {
    length = text(w.length);
  } catch (error) {
    length = failure(error);
  }
  return text(w) + ", captured " + text(read()) + ", added " + text(w + "!") + ", length " + length;
}

const functions: [string, (n?: number) => string][] = [
  ["honest", honest],
  ["past the end of a list", pastTheEnd],
  ["a hole", fromAHole],
  ["a missing key", missingKey],
  ["a parsed text", parsedText],
  ["a parsed null", parsedNull],
  ["an iterator that has ended", afterTheEnd],
  ["Reflect.get", reflected],
  ["two defaults in a chain", chained],
];

let warm = 0;
for (let i = 0; i < 2000; i++) for (const [, f] of functions) warm += f(i & 7).length;
sink.all.length = 0;
console.log("2000 rounds with the argument given: " + warm);

for (const [label, f] of functions) {
  console.log(label + ", given: " + f(5));
  console.log(label + ", not given: " + f());
  console.log(label + ", undefined given: " + f(undefined));
}
console.log("an object pattern: " + fromAPattern() + " | " + fromAPattern({}) + " | " + fromAPattern({ n: 5 }));
console.log("an array pattern: " + fromAnArrayPattern() + " | " + fromAnArrayPattern([5]));
console.log("a string parameter: " + word() + " | " + word("given"));
console.log("the list of numbers: " + sink.all.map(text).join(", "));
console.log("as json: " + JSON.stringify(sink.all));
