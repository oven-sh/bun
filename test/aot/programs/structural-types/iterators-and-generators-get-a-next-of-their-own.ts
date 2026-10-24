const log: string[] = [];

function* count(): Generator<number, undefined, unknown> {
  yield 1;
  yield 2;
  yield 3;
  return undefined;
}

function walk(it: Iterable<number>): string {
  const seen: number[] = [];
  for (const n of it) {
    seen.push(n);
    if (seen.length > 5) break;
  }
  return seen.join();
}

function walkGenerator(g: Generator<number, undefined, unknown>): string {
  const seen: number[] = [];
  for (const n of g) {
    seen.push(n);
    if (seen.length > 5) break;
  }
  return seen.join();
}

function spreadGenerator(g: Generator<number, undefined, unknown>): string {
  return [...g].join();
}

function* through(g: Generator<number, undefined, unknown>): Generator<number, undefined, unknown> {
  yield* g;
  return undefined;
}

function line(label: string, value: string): void {
  console.log(label + ": " + value + " [" + log.join(", ") + "]");
  log.length = 0;
}

function twice(): () => IteratorResult<number, undefined> {
  let calls = 0;
  return () => {
    log.push("own next");
    return ++calls <= 2 ? { done: false, value: calls * 100 } : { done: true, value: undefined };
  };
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += walkGenerator(count()).length + spreadGenerator(count()).length + walk([1, 2].values()).length;
line("2000 honest", String(warm));
line("a generator", walkGenerator(count()) + " | " + spreadGenerator(count()) + " | " + walk(through(count())));

function withNext(): Generator<number, undefined, unknown> {
  const g = count();
  g.next = twice();
  return g;
}

line("with a next of its own, for-of", walkGenerator(withNext()));
line("spread", spreadGenerator(withNext()));
line("yield*", walk(through(withNext())));
line("Array.from", Array.from(withNext()).join());
line("a pattern", (([a, b]: Iterable<number>) => a + " " + b)(withNext()));

const closing = count();
closing.return = value => {
  log.push("own return");
  return { done: true, value: undefined };
};
let firstSeen = 0;
for (const n of closing) {
  firstSeen = n;
  break;
}
line("with a return of its own, left early", firstSeen + ", then " + walkGenerator(closing));

const redirected = count();
redirected[Symbol.iterator] = () => {
  log.push("own iterator method");
  return count();
};
redirected.next();
line("with an iterator method of its own", walkGenerator(redirected) + " | by hand " + String(redirected.next().value));

const late = count();
const seen: number[] = [];
for (const n of late) {
  seen.push(n);
  late.next = twice();
}
line("a next that appears while the loop runs", seen.join());

const values = [1, 2, 3].values();
values.next = twice();
line("an array iterator with a next of its own", walk(values));

const keys = new Map([[1, "a"]]).keys();
keys.next = twice();
line("a map iterator with a next of its own", walk(keys));

const members = new Set([1]).values();
members.next = twice();
line("a set iterator with a next of its own", [...members].join());

const entries = [7, 8].entries();
entries.next = () => {
  log.push("own next of entries");
  return { done: true, value: undefined };
};
let pairs = 0;
for (const [index, value] of entries) pairs += index + value;
line("the entries of an array with a next of their own", String(pairs));

line("honest again", walkGenerator(count()) + " | " + walk([1, 2].values()));

export {};
