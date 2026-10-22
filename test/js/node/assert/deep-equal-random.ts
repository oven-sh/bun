// Seeded random pairs of values for the deep-equality tests. The second value of a pair is the first one with a
// few changes, so equal and unequal pairs both come out. The same seed gives the same pairs on every runtime,
// and node runs this file as it is.
import assert from "node:assert";
import util from "node:util";

type Spec = {
  kind: string;
  value?: unknown;
  flags?: string;
  lastIndex?: number;
  message?: string;
  errorClass?: string;
  cause?: Spec | null;
  tag?: unknown;
  symbols?: [symbol, Spec, boolean][];
  properties?: [string, Spec, boolean][];
  items?: Spec[];
  entries?: [Spec, Spec][];
};

const symbols = [Symbol("a"), Symbol("b"), Symbol.for("c")];
const keys = ["a", "b", "c", "0", "1", "x"];
const primitives = [0, 1, -0, NaN, "", "s", "1", "0", true, false, null, undefined, 1n, 0n, 2, "2", " 1 "];
const functions = [() => {}, function named() {}];
const kinds = [
  ...["object", "object", "object", "array", "array", "array", "map", "map", "set", "set", "error", "date"],
  ...["uint8Array", "float64Array", "number", "string", "boolean", "nullPrototype", "instance", "instanceWithField"],
  ...["getter", "arguments", "regexp", "function", "arrayBuffer", "weakMap", "promise"],
];

class Empty {}
class WithField {
  own = 1;
}

export function randomPairs(seed: number) {
  let state = seed >>> 0;
  // mulberry32
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)];

  function spec(depth: number): Spec {
    if (depth <= 0 || random() < 0.35) return { kind: "primitive", value: pick(primitives) };
    const symbolKeys: [symbol, Spec, boolean][] = [];
    if (random() < 0.25) symbolKeys.push([pick(symbols), spec(depth - 1), random() < 0.2]);
    const children = () => {
      const out: Spec[] = [];
      for (let i = 0, n = Math.floor(random() * 4); i < n; i++) {
        out.push(random() < 0.08 ? { kind: "hole" } : spec(depth - 1));
      }
      return out;
    };
    const properties: [string, Spec, boolean][] = [];
    for (let i = 0, n = Math.floor(random() * 3); i < n; i++) {
      const key = pick(keys);
      if (!properties.some(property => property[0] === key)) properties.push([key, spec(depth - 1), random() < 0.12]);
    }
    const tag = random() < 0.04 ? pick(["X", "Object", "Array", 1, "Date", "RegExp", "Map"]) : null;
    const kind = pick(kinds);
    const base: Spec = { kind, symbols: symbolKeys, tag, properties };
    switch (kind) {
      case "array":
      case "set":
      case "arguments":
        return { ...base, items: children() };
      case "map":
        return {
          ...base,
          entries: children()
            .filter(child => child.kind !== "hole")
            .map(key => [key, spec(depth - 1)]),
        };
      case "error":
        return {
          ...base,
          message: pick(["m", "n"]),
          errorClass: pick(["Error", "TypeError"]),
          cause: random() < 0.4 ? spec(depth - 1) : null,
        };
      case "date":
        return { ...base, value: pick([0, 1, NaN]) };
      case "uint8Array":
        return { ...base, value: pick([[1], [1, 2], []]) };
      case "float64Array":
        return { ...base, value: pick([[0], [-0], [NaN], [1]]) };
      case "number":
        return { ...base, value: pick([1, 2, 0, -0, NaN]) };
      case "string":
        return { ...base, value: pick(["a", "b", ""]) };
      case "boolean":
        return { ...base, value: pick([true, false]) };
      case "regexp":
        return { ...base, value: pick(["a", "b"]), flags: pick(["", "g"]), lastIndex: pick([0, 0, 1]) };
      case "arrayBuffer":
        return { ...base, value: pick([[1], [2], []]) };
      case "function":
        return { kind, value: pick([0, 1]) };
      default:
        return base;
    }
  }

  // `budget.chance` drops after each change, so most pairs differ in one place.
  function change(original: Spec, budget: { chance: number }): Spec {
    const out: Spec = { ...original };
    const hit = () => {
      if (random() >= budget.chance) return false;
      budget.chance /= 3;
      return true;
    };
    if (out.symbols) {
      out.symbols = out.symbols.flatMap(([key, value, hidden]): [symbol, Spec, boolean][] =>
        random() < 0.25 ? [] : [[key, random() < 0.4 ? spec(1) : value, hidden]],
      );
    }
    if (out.properties) {
      out.properties = out.properties.map(([key, value, hidden]) => [
        key,
        change(value, budget),
        hit() ? !hidden : hidden,
      ]);
      if (hit() && out.properties.length) {
        out.properties = random() < 0.5 ? out.properties.slice().reverse() : out.properties.slice(1);
      }
      if (hit()) out.properties = [...out.properties, [pick(keys), spec(1), false]];
    }
    if (out.items) {
      out.items = out.items.map(item => change(item, budget));
      if (hit() && out.items.length) out.items = random() < 0.5 ? out.items.slice().reverse() : out.items.slice(1);
      if (hit()) out.items = [...out.items, spec(1)];
    }
    if (out.entries) {
      out.entries = out.entries.map(([key, value]) => [change(key, budget), change(value, budget)]);
      if (hit() && out.entries.length) {
        out.entries = random() < 0.5 ? out.entries.slice().reverse() : out.entries.slice(1);
      }
      if (hit()) out.entries = [...out.entries, [spec(1), spec(1)]];
    }
    if (out.kind === "primitive" && hit()) out.value = pick(primitives);
    if (out.kind === "hole" && hit()) return { kind: "primitive", value: undefined };
    if (out.kind !== "primitive") {
      for (const field of ["value", "message", "errorClass", "flags", "lastIndex", "tag"] as const) {
        if (field in out && hit()) (out as Record<string, unknown>)[field] = spec(3)[field] ?? out[field];
      }
    }
    if (out.cause) out.cause = change(out.cause, budget);
    if (out.kind !== "primitive" && out.kind !== "hole" && random() < budget.chance / 6) return spec(2);
    return out;
  }

  function build(from: Spec): unknown {
    let object: any;
    const values = (from.items ?? []).filter(item => item.kind !== "hole").map(build);
    // A change can put a bigint where these constructors take a number.
    const numeric = typeof from.value === "bigint" ? Number(from.value) : from.value;
    switch (from.kind) {
      case "primitive":
        return from.value;
      case "function":
        return functions[from.value as number];
      case "object":
        object = {};
        break;
      case "nullPrototype":
        object = Object.create(null);
        break;
      case "instance":
        object = new Empty();
        break;
      case "instanceWithField":
        object = new WithField();
        break;
      case "getter":
        object = {
          get g() {
            return 1;
          },
        };
        break;
      case "array":
        object = [];
        from.items!.forEach((item, i) => {
          if (item.kind === "hole") object.length = i + 1;
          else object[i] = build(item);
        });
        break;
      case "arguments":
        object = (function (..._items: unknown[]) {
          return arguments;
        })(...values);
        break;
      case "set":
        object = new Set(values);
        break;
      case "map":
        object = new Map(from.entries!.map(([key, value]) => [build(key), build(value)]));
        break;
      case "error":
        object = new (from.errorClass === "TypeError" ? TypeError : Error)(
          from.message,
          from.cause ? { cause: build(from.cause) } : undefined,
        );
        break;
      case "date":
        object = new Date(numeric as number);
        break;
      case "uint8Array":
        object = new Uint8Array(numeric as number[]);
        break;
      case "float64Array":
        object = new Float64Array(numeric as number[]);
        break;
      case "arrayBuffer":
        object = new Uint8Array(numeric as number[]).buffer;
        break;
      case "number":
        object = new Number(from.value);
        break;
      case "string":
        object = new String(from.value);
        break;
      case "boolean":
        object = new Boolean(from.value);
        break;
      case "regexp":
        object = new RegExp(from.value as string, from.flags);
        object.lastIndex = from.lastIndex;
        break;
      case "weakMap":
        object = new WeakMap();
        break;
      case "promise":
        object = Promise.resolve(1);
        break;
    }
    const define = (key: PropertyKey, value: unknown, enumerable: boolean) => {
      try {
        Object.defineProperty(object, key, { value, enumerable, writable: true, configurable: true });
      } catch {
        // A typed array refuses an index key.
      }
    };
    for (const [key, value, hidden] of from.properties ?? []) define(key, build(value), !hidden || /^\d+$/.test(key));
    for (const [key, value, hidden] of from.symbols ?? []) define(key, build(value), !hidden);
    if (from.tag !== null && from.tag !== undefined) define(Symbol.toStringTag, from.tag, true);
    return object;
  }

  return {
    next() {
      const first = spec(3);
      const second = change(first, { chance: random() < 0.6 ? 0.35 : 0 });
      return { actual: () => build(first), expected: () => build(second) };
    },
  };
}

const notEqual = new Error("not equal");

// 0: equal, 1: not equal, 2: the comparison throws.
function outcome(compare: () => boolean) {
  try {
    return compare() ? 0 : 1;
  } catch (error) {
    if (error === notEqual) return 1;
    return 2;
  }
}

/** The verdicts of this runtime for the pairs `from` to `to` of a seed: one digit per pair, 3 × loose + strict. */
export function verdicts(seed: number, to: number, from = 0) {
  const pairs = randomPairs(seed);
  let digits = "";
  for (let i = 0; i < to; i++) {
    const pair = pairs.next();
    if (i < from) continue;
    const actual = pair.actual();
    const expected = pair.expected();
    const loose = outcome(() => (assert.deepEqual(actual, expected, notEqual), true));
    const strict = outcome(() => util.isDeepStrictEqual(actual, expected));
    digits += 3 * loose + strict;
  }
  return digits;
}

/** The pair behind one digit of `verdicts`. */
export function pairAt(seed: number, index: number) {
  const pairs = randomPairs(seed);
  for (let i = 0; i < index; i++) pairs.next();
  const pair = pairs.next();
  return { actual: pair.actual(), expected: pair.expected() };
}
