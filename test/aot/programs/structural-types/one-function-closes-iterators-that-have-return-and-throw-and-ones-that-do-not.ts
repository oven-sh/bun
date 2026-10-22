function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

type Walk = Iterator<number, string | undefined, undefined>;

function* generator(): Generator<number, string, undefined> {
  try {
    yield 1;
    yield 2;
    return "ran out";
  } finally {
    console.log("  the generator's finally");
  }
}

class OnlyNext implements Walk {
  n = 0;
  next(): IteratorResult<number, string | undefined> {
    return { done: false, value: ++this.n };
  }
}

class WithReturn extends OnlyNext {
  return(value?: string): IteratorResult<number, string | undefined> {
    console.log("  return got " + text(value) + " with " + arguments.length + " arguments");
    return { done: true, value: "closed by return" };
  }
}

class WithThrow extends OnlyNext {
  throw(error?: unknown): IteratorResult<number, string | undefined> {
    console.log("  throw got " + text(error) + " with " + arguments.length + " arguments");
    return { done: false, value: -1 };
  }
}

class ReturnIsUndefined extends OnlyNext {
  return: undefined = undefined;
  throw: undefined = undefined;
}

function close(walk: Walk): string {
  const first = walk.next();
  const closed = walk.return?.("please");
  const after = walk.next();
  return text(first) + " | " + text(closed) + " | " + text(after);
}

function closeWithNothing(walk: Walk): string {
  walk.next();
  return text(walk.return?.());
}

function upset(walk: Walk): string {
  walk.next();
  try {
    return text(walk.throw?.("upset"));
  } catch (error) {
    return failure(error);
  }
}

const makers: [string, () => Walk][] = [
  ["a generator", generator],
  ["only next", () => new OnlyNext()],
  ["with return", () => new WithReturn()],
  ["with throw", () => new WithThrow()],
  ["return is undefined", () => new ReturnIsUndefined()],
  ["an array's iterator", () => [1, 2, 3][Symbol.iterator]()],
  ["a set's iterator", () => new Set([1, 2, 3]).values()],
  ["a helper over an array", () => [1, 2, 3].values().map(n => n * 2)],
  ["a helper over a generator", () => generator().map(n => n * 2)],
];

for (const [label, make] of makers) {
  console.log(label + ", typeof return " + typeof make().return + ", typeof throw " + typeof make().throw);
  console.log(label + ", close: " + close(make()));
  console.log(label + ", close with nothing: " + closeWithNothing(make()));
  console.log(label + ", upset: " + upset(make()));
}

let count = 0;
for (let i = 0; i < 2000; i++) {
  const walk: Walk = new WithThrow();
  walk.next();
  if (walk.return === undefined) count++;
}
console.log("2000 without return: " + count);
console.log("then a generator at the shared site: " + close(generator()));
