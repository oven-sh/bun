function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

let log: string[] = [];

function* throwsInTheMiddle(): Generator<number, void, void> {
  try {
    yield 1;
    throw new RangeError("in the middle");
  } finally {
    log.push("finally");
  }
}

function* yieldsARejection(): Generator<number | Promise<number>, void, void> {
  try {
    yield 1;
    yield Promise.reject(new TypeError("rejected"));
    log.push("went on after the rejection");
    yield 3;
  } catch (error) {
    log.push("the generator caught " + failure(error));
  } finally {
    log.push("finally");
  }
}

function* returnsAPromise(): Generator<number, Promise<string>, void> {
  yield 1;
  return Promise.resolve("the end");
}

function* returnsARejection(): Generator<number, Promise<string>, void> {
  yield 1;
  return Promise.reject(new SyntaxError("at the end"));
}

function* yieldsInFinally(): Generator<number, void, void> {
  try {
    yield 1;
    yield 2;
  } finally {
    log.push("finally begins");
    yield 100;
    log.push("finally ends");
  }
}

function* throwsInFinally(): Generator<number, void, void> {
  try {
    yield 1;
    yield 2;
  } finally {
    log.push("finally throws");
    throw new EvalError("from finally");
  }
}

async function walk(items: Iterable<number | PromiseLike<number>>, stopAt: number): Promise<string> {
  const seen: string[] = [];
  try {
    for await (const n of items) {
      seen.push(text(n));
      if (n === stopAt) break;
    }
  } catch (error) {
    return seen.join() + " then " + failure(error);
  }
  return seen.join() + " then the loop ended";
}

async function bodyThrows(items: Iterable<number | PromiseLike<number>>): Promise<string> {
  try {
    for await (const n of items) throw new URIError("body " + n);
  } catch (error) {
    return failure(error);
  }
  return "empty";
}

const makers: [string, () => Iterable<number | PromiseLike<number>>][] = [
  ["throws in the middle", throwsInTheMiddle],
  ["yields a rejection", yieldsARejection],
  ["returns a promise", returnsAPromise],
  ["returns a rejection", returnsARejection],
  ["yields in finally", yieldsInFinally],
  ["throws in finally", throwsInFinally],
];

for (const [label, make] of makers) {
  log = [];
  console.log(label + ", to the end: " + (await walk(make(), -1)) + " [" + log.join(", ") + "]");
  log = [];
  console.log(label + ", left at 1: " + (await walk(make(), 1)) + " [" + log.join(", ") + "]");
  log = [];
  console.log(label + ", the body throws: " + (await bodyThrows(make())) + " [" + log.join(", ") + "]");
}

async function* relay(items: Iterable<number | PromiseLike<number>>): AsyncGenerator<number, string, void> {
  yield* items;
  return "relayed";
}

for (const [label, make] of makers) {
  log = [];
  const seen: string[] = [];
  try {
    const relaying = relay(make());
    for (let r = await relaying.next(); ; r = await relaying.next()) {
      seen.push(text(r.value));
      if (r.done) break;
    }
  } catch (error) {
    seen.push(failure(error));
  }
  console.log(label + ", through yield* of an async generator: " + seen.join(" | ") + " [" + log.join(", ") + "]");
}

export {};
