// Shared by the programs of this folder. Each prints what departs from its table, and a last line of sums.
// `validate` reads a getter and asks a trap of a Proxy once, into the copy that it judges and hands back. "read again" counts every further time.
// "called" counts what is never called: a method or an iterator of the value, a built-in that the program replaced.
let same = 0;
let other = 0;
let readAgain = 0;
let called = 0;

function isWellFormed(issue: unknown): boolean {
  if (typeof issue !== "object" || issue === null) return false;
  const { path, code, message } = issue as { path?: unknown; code?: unknown; message?: unknown };
  return Array.isArray(path) && typeof code === "string" && code !== "" && typeof message === "string" && message !== "";
}

export function verdictOf(check: () => unknown): string {
  try {
    check();
    return "accepted";
  } catch (error) {
    if (error instanceof TypeError) {
      const issues = (error as TypeError & { issues?: unknown }).issues;
      if (Array.isArray(issues) && issues.length > 0) return issues.every(isWellFormed) ? "refused" : "refused with a malformed issue";
    }
    return "threw " + (error instanceof Error ? error.name : typeof error);
  }
}

function expectVerdict(what: string, isExpected: (verdict: string) => boolean, expected: string, check: () => unknown) {
  const verdict = verdictOf(check);
  if (isExpected(verdict)) same++;
  else {
    other++;
    console.log("DIFFERS | " + what + " | expected " + expected + " | " + verdict);
  }
}

export const accepts = (what: string, check: () => unknown) => expectVerdict(what, verdict => verdict === "accepted", "accepted", check);
export const refuses = (what: string, check: () => unknown) => expectVerdict(what, verdict => verdict === "refused", "refused", check);
export const throwsRangeError = (what: string, check: () => unknown) =>
  expectVerdict(what, verdict => verdict === "threw RangeError", "threw RangeError", check);
/** Refused, or ended by a RangeError. Never accepted. */
export const endsClosed = (what: string, check: () => unknown) =>
  expectVerdict(what, verdict => verdict === "refused" || verdict === "threw RangeError", "refused or threw RangeError", check);

/** For a value that is valid and very deep. */
export const acceptsOrThrowsRangeError = (what: string, check: () => unknown) =>
  expectVerdict(what, verdict => verdict === "accepted" || verdict === "threw RangeError", "accepted or threw RangeError", check);

/** The same own keys in the same order, as data, on the same prototype, and the same values. `JSON.stringify` sees no hidden key, no symbol, no prototype and no `-0`. */
export function isSame(result: unknown, expected: unknown): boolean {
  if (typeof expected !== "object" || expected === null) return Object.is(result, expected);
  if (typeof result !== "object" || result === null) return false;
  if (Object.getPrototypeOf(result) !== Object.getPrototypeOf(expected)) return false;
  const keys = Reflect.ownKeys(expected);
  const found = Reflect.ownKeys(result);
  if (keys.length !== found.length) return false;
  for (let index = 0; index < keys.length; index++) {
    if (keys[index] !== found[index]) return false;
    const held = Object.getOwnPropertyDescriptor(result, keys[index])!;
    const wanted = Object.getOwnPropertyDescriptor(expected, keys[index])!;
    if (!("value" in held) || held.enumerable !== wanted.enumerable || !isSame(held.value, wanted.value)) return false;
  }
  return true;
}

function describe(value: unknown): string {
  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : String(value);
  const keys = Reflect.ownKeys(value).map(key => String(key));
  const isOrdinary = Object.getPrototypeOf(value) === (Array.isArray(value) ? Array.prototype : Object.prototype);
  return globalThis.JSON.stringify(value) + " with the own keys " + keys.join(", ") + (isOrdinary ? "" : " on another prototype");
}

/** Accepted, and what the call returns is exactly `expected`. */
export function handsBack(what: string, expected: unknown, make: () => unknown) {
  let result: unknown;
  const verdict = verdictOf(() => (result = make()));
  if (verdict === "accepted" && isSame(result, expected)) same++;
  else {
    other++;
    console.log("DIFFERS | " + what + " | expected " + describe(expected) + " | " + (verdict === "accepted" ? describe(result) : verdict));
  }
}

/** The value that a call returns. `expected` is written as JSON. */
export const yields = (what: string, expected: string, make: () => unknown) => handsBack(what, globalThis.JSON.parse(expected), make);

/** An accept hands back what `JSON.parse` makes of the text. */
export function both(
  what: string,
  byValue: (value: unknown) => unknown,
  byText: (text: string) => unknown,
  cases: Record<string, boolean>,
) {
  for (const text of Object.keys(cases)) {
    if (cases[text]) {
      yields(what + " | validate | " + text, text, () => byValue(globalThis.JSON.parse(text)));
      yields(what + " | parse | " + text, text, () => byText(text));
    } else {
      refuses(what + " | validate | " + text, () => byValue(globalThis.JSON.parse(text)));
      refuses(what + " | parse | " + text, () => byText(text));
    }
  }
}

/** Nobody else holds what an accept hands back: `change` writes to the value that was handed in, and the result stays as it was. */
export function holdsItsOwnCopy<T extends object>(what: string, given: T, expected: unknown, check: (value: T) => unknown, change: (value: T) => void) {
  handsBack(what, expected, () => {
    const result = check(given);
    change(given);
    return result;
  });
}

/** Refused, and the message of the first issue ends with `ending`. */
export function refusesSaying(what: string, ending: string, check: () => unknown) {
  let said = "accepted";
  try {
    check();
  } catch (error) {
    const issues = (error as { issues?: { message: unknown }[] }).issues;
    said = Array.isArray(issues) && issues.length > 0 ? String(issues[0].message) : "threw";
  }
  if (said.endsWith(ending)) same++;
  else {
    other++;
    console.log("DIFFERS | " + what + " | expected a message that ends with " + ending + " | " + said);
  }
}

/** Refused, and one of the issues is about the value at `path`. */
export function refusesAt(what: string, path: (string | number)[], check: () => unknown) {
  let paths = "accepted";
  try {
    check();
  } catch (error) {
    const issues = (error as { issues?: { path: unknown }[] }).issues;
    paths = Array.isArray(issues) ? issues.map(issue => globalThis.JSON.stringify(issue.path)).join(" ") : "threw";
  }
  if (paths.split(" ").includes(globalThis.JSON.stringify(path))) same++;
  else {
    other++;
    console.log("DIFFERS | " + what + " | expected an issue at " + globalThis.JSON.stringify(path) + " | " + paths);
  }
}

/** An object whose getter answers `first` to the first read and `later` to every other. What is judged and what is handed back is `first`. */
export function changing(key: string, first: unknown, later: unknown, others: Record<string, unknown> = {}): object {
  let reads = 0;
  return Object.defineProperty({ ...others }, key, {
    enumerable: true,
    configurable: true,
    get() {
      if (reads++ === 0) return first;
      readAgain++;
      return later;
    },
  });
}

export const withGetter = (key: string, value: unknown, others: Record<string, unknown> = {}) => changing(key, value, value, others);

/** A Proxy that answers each question about each key by `first` the first time and by `later` every other time. */
export function changingProxy(first: object, later: object): object {
  const asked = new Set<string>();
  const now = (question: string, key: PropertyKey = ""): object => {
    const name = question + " " + String(key);
    if (!asked.has(name)) {
      asked.add(name);
      return first;
    }
    readAgain++;
    return later;
  };
  return new Proxy(Array.isArray(first) ? [] : {}, {
    get: (_, key) => Reflect.get(now("get", key), key),
    has: (_, key) => Reflect.has(now("has", key), key),
    ownKeys: () => Reflect.ownKeys(now("ownKeys")),
    getOwnPropertyDescriptor: (_, key) => Reflect.getOwnPropertyDescriptor(now("getOwnPropertyDescriptor", key), key),
    getPrototypeOf: () => Reflect.getPrototypeOf(now("getPrototypeOf")),
  });
}

export const proxyOf = (target: object) => changingProxy(target, target);

export function noteCall() {
  called++;
}

/** Methods that a writer, a comparison or a conversion to a string would call. */
export function withMethods(): object {
  const ran = () => {
    called++;
    return "1";
  };
  return { toJSON: ran, valueOf: ran, toString: ran, [Symbol.toPrimitive]: ran };
}

export function withIterator<T>(array: T[]): T[] {
  return Object.assign(array, {
    [Symbol.iterator]() {
      called++;
      return [][Symbol.iterator]();
    },
  });
}

function fastestOf(run: () => unknown): number {
  let fastest = Infinity;
  for (let round = 0; round < 3; round++) {
    const start = performance.now();
    try {
      run();
    } catch {}
    fastest = Math.min(fastest, performance.now() - start);
  }
  return fastest;
}

/** Four times the size takes four times as long if the time is linear, and sixteen times if it is quadratic. Eight times is the limit. */
export function growsLinearly(what: string, size: number, make: (size: number) => () => unknown) {
  const small = fastestOf(make(size));
  const large = fastestOf(make(4 * size));
  if (large <= 8 * small + 20) same++;
  else {
    other++;
    console.log("DIFFERS | " + what + " | " + size + " took " + small.toFixed(1) + " ms and " + 4 * size + " took " + large.toFixed(1) + " ms");
  }
}

export const hidden = (key: string, value: unknown, others: Record<string, unknown> = {}): object =>
  Object.defineProperty({ ...others }, key, { value, enumerable: false });
export const inheriting = (from: object, own: Record<string, unknown> = {}): object => Object.assign(Object.create(from), own);

export function finish() {
  console.log("same " + same + " other " + other + " read again " + readAgain + " called " + called);
}
