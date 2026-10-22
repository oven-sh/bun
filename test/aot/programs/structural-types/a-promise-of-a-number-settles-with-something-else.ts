function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

const table: number[] = [1, 2];

class Sink {
  last: number = 0;
  all: number[] = [];
}
const sink = new Sink();

function use(n: number): string {
  const read = (): number => n;
  sink.last = n;
  sink.all.push(n);
  let fixed: string;
  try {
    fixed = n.toFixed(1);
  } catch (error) {
    fixed = failure(error);
  }
  return text(n) + ", captured " + text(read()) + ", next " + text(n + 1) + ", whole " + text(n | 0) + ", field " + text(sink.last) + ", element " + text(sink.all[sink.all.length - 1]) + ", " + fixed;
}

async function awaited(p: Promise<number>): Promise<string> {
  const n: number = await p;
  return use(n);
}

async function awaitedAndAdded(p: Promise<number>): Promise<string> {
  let sum = 10;
  sum += await p;
  return text(sum);
}

function reacted(p: Promise<number>): Promise<string> {
  return p.then(use);
}

function reactedByAnArrow(p: Promise<number>): Promise<string> {
  return p.then(n => text(n * 2));
}

async function together(p: Promise<number>): Promise<string> {
  const [a, b]: [number, number] = await Promise.all([p, 1]);
  return use(a) + " and " + text(a + b);
}

async function* streamed(p: Promise<number>): AsyncGenerator<number, void, void> {
  yield p;
}
async function throughAStream(p: Promise<number>): Promise<string> {
  for await (const n of streamed(p)) return use(n);
  return "empty";
}

async function pastTheEnd(): Promise<number> {
  return table[9];
}
async function parsed(): Promise<number> {
  return JSON.parse('"text"');
}

const makers: [string, () => Promise<number>][] = [
  ["honest", () => Promise.resolve(3)],
  ["a fraction", () => Promise.resolve(0.5)],
  ["an async function returns an element past the end", pastTheEnd],
  ["an async function returns a parsed text", parsed],
  ["resolve of a parsed text", () => Promise.resolve(JSON.parse('"7"'))],
  ["resolve of a parsed null", () => Promise.resolve(JSON.parse("null"))],
  ["resolve of a parsed list", () => Promise.resolve(JSON.parse("[4]"))],
  ["a resolve function gets an element past the end", () => new Promise<number>(resolve => resolve(table[9]))],
  ["a reaction returns an element past the end", () => Promise.resolve(0).then(() => table[9])],
  ["a resolve function is called with nothing behind a wider type", () => new Promise<number>(resolve => {
    const loose: (...given: number[]) => void = resolve;
    loose();
  })],
];

const uses: [string, (p: Promise<number>) => Promise<string>][] = [
  ["awaited", awaited],
  ["awaited and added", awaitedAndAdded],
  ["a named reaction", reacted],
  ["an arrow reaction", reactedByAnArrow],
  ["Promise.all", together],
  ["an async generator", throughAStream],
];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += use(i & 7).length + (await awaited(Promise.resolve(i & 7))).length;
sink.all.length = 0;
console.log("2000 honest rounds: " + warm);

for (const [label, make] of makers) for (const [name, run] of uses) console.log(label + ", " + name + ": " + (await run(make()).catch(failure)));

console.log("the list of numbers: " + sink.all.map(text).join(", "));
console.log("honest again: " + use(1) + " | " + (await awaited(Promise.resolve(2))));

export {};
