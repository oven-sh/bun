// The diff of a failed toMatchObject() asks some matchers after the first mismatch (https://github.com/oven-sh/bun/issues/9089).
// It starts no function of expect.extend() and no asymmetricMatch() method for that, and reads no promise. Nothing would
// wait for them: what they do later would count for another test, and a promise that rejects later would not be reported.
// The end of each name says how the test must end: "... fails" fails, each other test passes.
// Run by expect-deferred.test.ts, and with --aot by test/aot/a-match-that-failed-asks-the-matchers-beside-a-private-field-that-differs.test.ts.
import { expect, test } from "bun:test";

let open: () => void = () => {};
let gate: Promise<void> = Promise.resolve();
// What an abandoned matcher would do later: an assertion that counts for the test that runs then.
const assertsLater = async (received: unknown) => {
  await gate;
  expect(received).toBe(1);
  return { pass: true, message: () => "" };
};
let spent = 0;
expect.extend({
  async toAssertLater(received: unknown) {
    await gate;
    expect(received).toBe(1);
    return { pass: true, message: () => "" };
  },
  async toAssertLaterWithNoAwait(received: unknown) {
    return assertsLater(received);
  },
  toAssertLaterInAPromise(received: unknown) {
    return assertsLater(received);
  },
  toAssertLaterBound: assertsLater.bind(null),
  toAssertNow(received: unknown) {
    expect(received).toBe(1);
    return { pass: true, message: () => "" };
  },
  toPassOneTime() {
    return { pass: spent++ === 0, message: () => "passed before" };
  },
});
const matchers = expect as any;

class Box {
  c: unknown;
  constructor(c: unknown) {
    this.c = c;
  }
}
class List extends Array {}
const sparse = (value: unknown) => {
  const list: unknown[] = [];
  list[5000] = value;
  return list;
};
const url = (c: unknown) => Object.assign(new URL("http://localhost/"), { c });
// A private field on a plain object: the constructor of the base class returns the object that it gets.
class ReturnsWhatItGets {
  constructor(object: object) {
    return object;
  }
}
class Stamp extends ReturnsWhatItGets {
  #kept: unknown;
  constructor(object: object, kept: unknown) {
    super(object);
    this.#kept = kept;
  }
}
const stamped = (kept: unknown) => new Stamp({}, kept);

// What holds the value and the matcher: [received, pattern].
const holders: Record<string, (value: unknown, matcher: unknown) => [unknown, unknown]> = {
  "at the key": (value, matcher) => [value, matcher],
  "in expect.objectContaining()": (value, matcher) => [{ c: value }, expect.objectContaining({ c: matcher })],
  "in expect.arrayContaining()": (value, matcher) => [[value], expect.arrayContaining([matcher])],
  "in a class instance": (value, matcher) => [new Box(value), expect.objectContaining(new Box(matcher))],
  "in an object with no prototype": (value, matcher) => [
    { c: value },
    expect.objectContaining(Object.assign(Object.create(null), { c: matcher })),
  ],
  "behind a getter": (value, matcher) => [
    { c: value },
    expect.objectContaining({
      get c() {
        return matcher;
      },
    }),
  ],
  "in a Map": (value, matcher) => [
    { c: new Map([["k", value]]) },
    expect.objectContaining({ c: new Map([["k", matcher]]) }),
  ],
  "in a Set": (value, matcher) => [{ c: new Set([value]) }, expect.objectContaining({ c: new Set([matcher]) })],
  "in a Proxy": (value, matcher) => [{ c: value }, expect.objectContaining(new Proxy({ c: matcher }, {}))],
  "in a frozen array": (value, matcher) => [[value], expect.arrayContaining(Object.freeze([matcher]))],
  "in a sparse array": (value, matcher) => [{ c: sparse(value) }, expect.objectContaining({ c: sparse(matcher) })],
  "in an Array subclass": (value, matcher) => [{ c: List.of(value) }, expect.objectContaining({ c: List.of(matcher) })],
  "in an array of class instances": (value, matcher) => [[new Box(value)], expect.arrayContaining([new Box(matcher)])],
  "in a URL": (value, matcher) => [url(value), expect.objectContaining(url(matcher))],
  "beside two other values in expect.objectContaining()": (value, matcher) => [
    { b: 1, c: value, d: [1] },
    expect.objectContaining({ b: 1, c: matcher, d: [1] }),
  ],
  "in the received value, under expect.objectContaining()": (value, matcher) => [
    { c: matcher },
    expect.objectContaining({ c: value }),
  ],
  "in the received value, under expect.arrayContaining()": (value, matcher) => [
    [{ c: matcher }],
    expect.arrayContaining([{ c: value }]),
  ],
  "in a private field of a plain object, under expect.objectContaining()": (value, matcher) => [
    stamped(value),
    expect.objectContaining(stamped(matcher)),
  ],
  "in a private field of the received value, under expect.objectContaining()": (value, matcher) => [
    stamped(matcher),
    expect.objectContaining(stamped(value)),
  ],
};

const failsTheMatch = (received: unknown, pattern: unknown) => {
  let message;
  try {
    expect({ a: 1, b: received }).toMatchObject({ a: 2, b: pattern });
  } catch (error) {
    message = Bun.stripANSI((error as Error).message);
  }
  if (!message?.startsWith("expect(received).toMatchObject(expected)"))
    throw new Error("not the failed match: " + message);
};
const aTurnOfTheLoop = () => new Promise(resolve => setImmediate(resolve));

// A matcher that the diff started goes on in the next test, and its assertion makes that test pass.
function startsNoMatcher(name: string, sides: () => [unknown, unknown]) {
  test(name + ": the failed match", () => {
    gate = new Promise(resolve => (open = resolve));
    failsTheMatch(...sides());
  });
  test(name + ": the next test has no assertion and fails", async () => {
    expect.hasAssertions();
    open();
    await aTurnOfTheLoop();
  });
}
// A promise that is pending at the failed match and rejects after it. Nothing handles it.
function readsNoPromise(name: string, hold: (value: unknown, matcher: unknown) => [unknown, unknown]) {
  test(name + ": a promise that rejects after the failed match fails", async () => {
    let reject: (reason: Error) => void = () => {};
    const pending = new Promise((_, rejectIt) => (reject = rejectIt));
    failsTheMatch(...hold(pending, expect.rejectsTo.any(Error)));
    reject(new Error("rejected after the failed match"));
    await aTurnOfTheLoop();
  });
}

for (const [name, hold] of Object.entries(holders)) startsNoMatcher(name, () => hold(1, matchers.toAssertLater()));
startsNoMatcher("a function with no await that returns a promise", () => [1, matchers.toAssertLaterWithNoAwait()]);
startsNoMatcher("a function that is not async and returns a promise", () => [1, matchers.toAssertLaterInAPromise()]);
startsNoMatcher("a bound async function", () => [1, matchers.toAssertLaterBound()]);
for (const [name, hold] of Object.entries(holders)) readsNoPromise(name, hold);

// These come last: a tester stays for the rest of the file. It is the tester of the docs, which hands what two books hold
// back to the comparison. The diff asks no tester, so it starts nothing through one.
class Book {
  authors: unknown;
  constructor(authors: unknown) {
    this.authors = authors;
  }
}
const behindATester = "in what a tester hands to this.equals()";
let registered = false;
const books = (value: unknown, matcher: unknown): [unknown, unknown] => {
  if (!registered) {
    registered = true;
    expect.addEqualityTesters([
      function (this: any, a: unknown, b: unknown, customTesters: unknown) {
        if (a instanceof Book && b instanceof Book) return this.equals(a.authors, b.authors, customTesters);
        return undefined;
      },
    ]);
  }
  return [new Book(value), new Book(matcher)];
};
startsNoMatcher(behindATester, () => books(1, matchers.toAssertLater()));
readsNoPromise(behindATester, books);
test(behindATester + ": an asymmetricMatch() method is not called", () => {
  let called = 0;
  const answersItself = {
    asymmetricMatch() {
      called++;
      return true;
    },
  };
  failsTheMatch(...books(1, answersItself));
  failsTheMatch(...books(answersItself, 1));
  expect(called).toBe(0);
});
test(behindATester + ": expect.assertions(1) counts the failed match alone", () => {
  expect.assertions(1);
  failsTheMatch(...books(1, matchers.toAssertNow()));
});
test(behindATester + ": expect.poll() passes with a matcher that passes one time", async () => {
  spent = 0;
  let attempts = 0;
  await expect
    .poll(() => ({ ready: ++attempts >= 3, book: new Book(1) }), { interval: 1 })
    .toMatchObject({ ready: true, book: new Book(matchers.toPassOneTime()) });
  expect({ attempts, spent }).toEqual({ attempts: 3, spent: 1 });
});
