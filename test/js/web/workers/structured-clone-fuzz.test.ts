import { describe, expect, test } from "bun:test";

// Seeded generative round-trip fuzz for the structured clone serializer. Each
// graph is cloned via structuredClone and via a real MessagePort hop, then a
// bidirectional graph walker asserts the clone is isomorphic to the original.

// Deterministic PRNG (mulberry32) so every run exercises identical graphs.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  #next: () => number;
  constructor(seed: number) {
    this.#next = mulberry32(seed);
  }
  float(): number {
    return this.#next();
  }
  // An integer in [0, n).
  int(n: number): number {
    return Math.floor(this.#next() * n);
  }
  bool(probability = 0.5): boolean {
    return this.#next() < probability;
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
}

// ------------------------------- grammar -----------------------------------
// Three things are deliberately absent because they do not round-trip on main
// yet, each with an open fix: SharedArrayBuffer (#32804), Error.cause
// (#31525), and a File constructed with an empty filename (#32434).

const LONG_STRING = Buffer.alloc(512, "s").toString();

// Leaves that have historically broken serializers: signed zero, non-finite
// doubles, lone surrogates, and BigInts that need more than one 64-bit limb.
const LEAVES: readonly unknown[] = [
  undefined,
  null,
  true,
  false,
  0,
  -0,
  1,
  -1,
  0.5,
  -2.25,
  1e300,
  5e-324,
  Number.EPSILON,
  Number.MAX_SAFE_INTEGER,
  Number.MAX_SAFE_INTEGER + 2,
  2 ** 31,
  -(2 ** 31) - 1,
  NaN,
  Infinity,
  -Infinity,
  0n,
  1n,
  -1n,
  255n,
  256n,
  2n ** 64n,
  -(2n ** 100n),
  "",
  "a",
  "k",
  "\u0000",
  "\uD800",
  "\uDC00",
  "\uDBFF\uDFFD",
  "a\u0000b",
  "é",
  "日本語",
  "🙂",
  LONG_STRING,
];
const STRINGS = LEAVES.filter((x): x is string => typeof x === "string");
const NUMBERS = LEAVES.filter((x): x is number => typeof x === "number");
const BIGINTS = LEAVES.filter((x): x is bigint => typeof x === "bigint");

// "__proto__" is intentionally absent: `o["__proto__"] = v` invokes the setter.
const OBJECT_KEYS: readonly string[] = [
  "a",
  "b",
  "c",
  "x",
  "y",
  "",
  "0",
  "1",
  "10",
  "01",
  "-1",
  "1.5",
  "length",
  "k\u0000",
  "日本",
  "🙂",
];
// Array extras exclude "length" and canonical array indices.
const ARRAY_EXTRA_KEYS: readonly string[] = ["p", "q", "", "-1", "1.5", "1e3", "名", "k\u0000"];

const ERROR_TYPES = [Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError] as const;
const DOM_EXCEPTION_NAMES = [
  "AbortError",
  "DataCloneError",
  "NotFoundError",
  "InvalidStateError",
  "SyntaxError",
  "TimeoutError",
  "NotARealDOMExceptionName",
  "",
] as const;

// A fixed set of known-valid (source, flags) pairs covering every RegExp flag.
const REGEXPS: readonly RegExp[] = [
  /a/,
  /a(b)c/g,
  /^x$/im,
  /[0-9]+/y,
  /(?:z)*/s,
  /./d,
  /x{2,3}/giy,
  /a/u,
  /[0-9]/v,
  /(?<n>y)\k<n>/gu,
  /(?<=a)b/d,
  /\p{L}+/gu,
];

const BLOB_CONTENTS = ["", "hello", "\u0000\u0001", "日本語", "\uD800"] as const;
const BLOB_TYPES = ["", "text/plain", "application/octet-stream", "x/y;a=b"] as const;
const FILE_NAMES = ["a.txt", "名前.bin", "with spaces & (chars).png"] as const;

const TYPED_ARRAY_TYPES = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float16Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
] as const;

const DATE_TIME_VALUES = [0, -0, NaN, 1, -1, 1e12, -1e12, 8.64e15, -8.64e15, 8.64e15 + 1] as const;

interface GenState {
  rng: Rng;
  // Every object created so far. Back-references draw from it, and because it
  // already contains the in-progress ancestors, that is also how cycles form.
  pool: object[];
  buffers: ArrayBuffer[];
  nodesLeft: number;
}

function track<T extends object>(state: GenState, value: T): T {
  state.pool.push(value);
  return value;
}

function fillWithRandomBytes(buffer: ArrayBuffer, rng: Rng): void {
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) bytes[i] = rng.int(256);
}

function genArrayBuffer(state: GenState): ArrayBuffer {
  const { rng } = state;
  const byteLength = rng.int(33);
  const buffer = rng.bool(0.35)
    ? new ArrayBuffer(byteLength, { maxByteLength: byteLength + rng.int(48) })
    : new ArrayBuffer(byteLength);
  fillWithRandomBytes(buffer, rng);
  state.buffers.push(buffer);
  return track(state, buffer);
}

function genView(state: GenState): ArrayBufferView {
  const { rng } = state;
  // Reusing an existing buffer makes views alias; the walker then requires the
  // cloned views to share one cloned buffer too.
  const buffer = state.buffers.length > 0 && rng.bool(0.5) ? rng.pick(state.buffers) : genArrayBuffer(state);
  const isDataView = rng.bool(0.2);
  const Ctor: any = isDataView ? DataView : rng.pick(TYPED_ARRAY_TYPES);
  const bytesPerElement: number = isDataView ? 1 : Ctor.BYTES_PER_ELEMENT;
  const byteOffset = rng.int(Math.floor(buffer.byteLength / bytesPerElement) + 1) * bytesPerElement;
  // Length-tracking views are only constructible over a resizable buffer.
  if (buffer.resizable && rng.bool(0.5)) return track(state, new Ctor(buffer, byteOffset));
  const length = rng.int(Math.floor((buffer.byteLength - byteOffset) / bytesPerElement) + 1);
  return track(state, new Ctor(buffer, byteOffset, isDataView ? length * bytesPerElement : length));
}

function genBoxedPrimitive(rng: Rng): object {
  switch (rng.int(4)) {
    case 0:
      return Object(rng.pick(NUMBERS));
    case 1:
      return Object(rng.pick(STRINGS));
    case 2:
      return Object(rng.bool());
    default:
      return Object(rng.pick(BIGINTS));
  }
}

function genRegExp(rng: Rng): RegExp {
  const base = rng.pick(REGEXPS);
  const regexp = new RegExp(base.source, base.flags);
  regexp.lastIndex = rng.int(100);
  return regexp;
}

const MAX_DEPTH = 7;
const BACK_REFERENCE_PROBABILITY = 0.14;

function genValue(state: GenState, depth: number): unknown {
  const { rng } = state;
  if (state.pool.length > 0 && rng.float() < BACK_REFERENCE_PROBABILITY) return rng.pick(state.pool);
  if (depth >= MAX_DEPTH || state.nodesLeft <= 0) return rng.pick(LEAVES);
  state.nodesLeft--;
  switch (rng.int(20)) {
    case 0:
    case 1: {
      const object: Record<string, unknown> = {};
      track(state, object);
      const count = 1 + rng.int(4);
      for (let i = 0; i < count; i++) object[rng.pick(OBJECT_KEYS)] = genValue(state, depth + 1);
      return object;
    }
    case 2:
    case 3: {
      const array: unknown[] = [];
      track(state, array);
      array.length = rng.int(7);
      for (let i = 0; i < array.length; i++) {
        if (rng.bool(0.82)) array[i] = genValue(state, depth + 1);
      }
      if (rng.bool(0.3)) (array as any)[rng.pick(ARRAY_EXTRA_KEYS)] = genValue(state, depth + 1);
      return array;
    }
    case 4: {
      const map = new Map<unknown, unknown>();
      track(state, map);
      const count = rng.int(4);
      for (let i = 0; i < count; i++) map.set(genValue(state, depth + 1), genValue(state, depth + 1));
      return map;
    }
    case 5: {
      const set = new Set<unknown>();
      track(state, set);
      const count = rng.int(5);
      for (let i = 0; i < count; i++) set.add(genValue(state, depth + 1));
      return set;
    }
    case 6:
      return track(state, new Date(rng.pick(DATE_TIME_VALUES)));
    case 7:
      return track(state, genRegExp(rng));
    case 8:
      return track(state, new (rng.pick(ERROR_TYPES))(rng.pick(STRINGS)));
    case 9:
      return track(state, new DOMException(rng.pick(STRINGS), rng.pick(DOM_EXCEPTION_NAMES)));
    case 10:
      return track(state, genBoxedPrimitive(rng));
    case 11:
      return genArrayBuffer(state);
    case 12:
    case 13:
      return genView(state);
    case 14:
      return track(state, new Blob([rng.pick(BLOB_CONTENTS)], { type: rng.pick(BLOB_TYPES) }));
    case 15:
      return track(
        state,
        new File([rng.pick(BLOB_CONTENTS)], rng.pick(FILE_NAMES), {
          type: rng.pick(BLOB_TYPES),
          lastModified: rng.int(2_000_000_000_000),
        }),
      );
    default:
      return rng.pick(LEAVES);
  }
}

function buildGraph(seed: number): object {
  const state: GenState = { rng: new Rng(seed), pool: [], buffers: [], nodesLeft: 64 };
  const root: Record<string, unknown> = {};
  state.pool.push(root);
  const count = 2 + state.rng.int(4);
  for (let i = 0; i < count; i++) root["r" + i] = genValue(state, 1);
  return root;
}

// ------------------------------ verifier -----------------------------------

function describeValue(value: unknown): string {
  if (typeof value === "string") {
    const quoted = JSON.stringify(value);
    return quoted.length > 64 ? `${quoted.slice(0, 61)}..."` : quoted;
  }
  if (typeof value === "bigint") return `${value}n`;
  if (Object.is(value, -0)) return "-0";
  return String(value);
}

function prototypeName(value: object): string {
  const proto = Object.getPrototypeOf(value);
  if (proto === null) return "null";
  return proto.constructor?.name ?? "(anonymous prototype)";
}

// Walks the original and the clone in lockstep. `forward` maps every original
// object to its clone and `backward` the reverse, so both directions of the
// identity topology are enforced: shared references neither split nor merge.
function assertSameGraph(original: unknown, clone: unknown): number {
  const forward = new Map<object, object>();
  const backward = new Map<object, object>();
  let visited = 0;

  function fail(path: string, message: string): never {
    throw new Error(`${message} at $${path}`);
  }
  function check(expected: unknown, actual: unknown, path: string, what: string): void {
    if (!Object.is(expected, actual)) {
      fail(path, `${what}: expected ${describeValue(expected)}, got ${describeValue(actual)}`);
    }
  }
  function checkSameKeys(o: object, c: object, path: string): void {
    const originalKeys = Object.keys(o);
    const cloneKeys = Object.keys(c);
    if (originalKeys.length !== cloneKeys.length || originalKeys.some((key, i) => key !== cloneKeys[i])) {
      fail(path, `own key layout differs: [${originalKeys.map(describeValue)}] vs [${cloneKeys.map(describeValue)}]`);
    }
  }
  function checkSameBytes(o: Uint8Array, c: Uint8Array, path: string): void {
    check(o.length, c.length, path, "byte length");
    for (let i = 0; i < o.length; i++) {
      if (o[i] !== c[i]) fail(path, `byte ${i} differs: ${o[i]} !== ${c[i]}`);
    }
  }

  function walk(o: unknown, c: unknown, path: string): void {
    visited++;
    if (o === null || typeof o !== "object") {
      check(o, c, path, `${typeof o} leaf`);
      return;
    }
    if (c === null || typeof c !== "object") fail(path, `expected an object, got ${describeValue(c)}`);
    if (c === o) fail(path, "the clone is the same object as the original");
    const known = forward.get(o);
    if (known !== undefined) {
      if (known !== c) fail(path, "a shared reference in the original became two distinct objects in the clone");
      return;
    }
    if (backward.has(c)) fail(path, "two distinct objects in the original became one object in the clone");
    forward.set(o, c);
    backward.set(c, o);

    if (Object.getPrototypeOf(c) !== Object.getPrototypeOf(o)) {
      fail(path, `prototype mismatch: expected ${prototypeName(o)}, got ${prototypeName(c)}`);
    }

    if (Array.isArray(o)) {
      const cloneArray = c as unknown[];
      check(o.length, cloneArray.length, path, "array length");
      checkSameKeys(o, cloneArray, path);
      for (const key of Object.keys(o))
        walk((o as any)[key], (cloneArray as any)[key], `${path}[${describeValue(key)}]`);
      return;
    }
    if (o instanceof Date) {
      check(o.getTime(), (c as Date).getTime(), path, "Date time value");
      return;
    }
    if (o instanceof RegExp) {
      const cloneRegExp = c as RegExp;
      check(o.source, cloneRegExp.source, path, "RegExp source");
      check(o.flags, cloneRegExp.flags, path, "RegExp flags");
      // lastIndex is not serialized; a freshly deserialized RegExp starts at 0.
      check(0, cloneRegExp.lastIndex, path, "RegExp lastIndex");
      return;
    }
    if (o instanceof ArrayBuffer) {
      const cloneBuffer = c as ArrayBuffer;
      check(o.byteLength, cloneBuffer.byteLength, path, "ArrayBuffer byteLength");
      check(o.resizable, cloneBuffer.resizable, path, "ArrayBuffer resizable");
      if (o.resizable) check(o.maxByteLength, cloneBuffer.maxByteLength, path, "ArrayBuffer maxByteLength");
      checkSameBytes(new Uint8Array(o), new Uint8Array(cloneBuffer), path);
      return;
    }
    if (ArrayBuffer.isView(o)) {
      const cloneView = c as ArrayBufferView;
      check(o.byteOffset, cloneView.byteOffset, path, "view byteOffset");
      check(o.byteLength, cloneView.byteLength, path, "view byteLength");
      if (!(o instanceof DataView)) {
        const originalTyped = o as any;
        const cloneTyped = cloneView as any;
        check(originalTyped.length, cloneTyped.length, path, "TypedArray length");
        for (let i = 0; i < originalTyped.length; i++) {
          check(originalTyped[i], cloneTyped[i], `${path}[${i}]`, "TypedArray element");
        }
      }
      // Recursing into .buffer checks aliasing topology: views that shared one
      // buffer in the original must share one (fully identical) buffer here.
      walk(o.buffer, cloneView.buffer, `${path}.buffer`);
      return;
    }
    if (o instanceof Map) {
      const cloneMap = c as Map<unknown, unknown>;
      check(o.size, cloneMap.size, path, "Map size");
      const originalEntries = [...o.entries()];
      const cloneEntries = [...cloneMap.entries()];
      for (let i = 0; i < originalEntries.length; i++) {
        walk(originalEntries[i][0], cloneEntries[i][0], `${path}.keyAt(${i})`);
        walk(originalEntries[i][1], cloneEntries[i][1], `${path}.valueAt(${i})`);
      }
      return;
    }
    if (o instanceof Set) {
      const cloneSet = c as Set<unknown>;
      check(o.size, cloneSet.size, path, "Set size");
      const originalValues = [...o];
      const cloneValues = [...cloneSet];
      for (let i = 0; i < originalValues.length; i++) {
        walk(originalValues[i], cloneValues[i], `${path}.at(${i})`);
      }
      return;
    }
    if (o instanceof DOMException) {
      const cloneException = c as DOMException;
      check(o.name, cloneException.name, path, "DOMException name");
      check(o.message, cloneException.message, path, "DOMException message");
      check(o.code, cloneException.code, path, "DOMException code");
      return;
    }
    if (o instanceof Error) {
      const cloneError = c as Error;
      check(o.name, cloneError.name, path, "Error name");
      check(o.message, cloneError.message, path, "Error message");
      check(o.stack, cloneError.stack, path, "Error stack");
      return;
    }
    if (o instanceof Blob) {
      const cloneBlob = c as Blob;
      check(o.size, cloneBlob.size, path, "Blob size");
      check(o.type, cloneBlob.type, path, "Blob type");
      if (o instanceof File) {
        const cloneFile = c as File;
        check(o.name, cloneFile.name, path, "File name");
        check(o.lastModified, cloneFile.lastModified, path, "File lastModified");
      }
      return;
    }
    if (o instanceof Number || o instanceof String || o instanceof Boolean || o instanceof BigInt) {
      check((o as any).valueOf(), (c as any).valueOf(), path, "boxed primitive value");
      return;
    }
    if (Object.getPrototypeOf(o) !== Object.prototype) {
      fail(path, `the generator produced an unhandled type: ${prototypeName(o)}`);
    }
    if (Object.getOwnPropertySymbols(c).length !== 0) fail(path, "the clone has symbol-keyed properties");
    checkSameKeys(o, c, path);
    for (const key of Object.keys(o)) walk((o as any)[key], (c as any)[key], `${path}.${describeValue(key)}`);
  }

  walk(original, clone, "");
  // The two graphs must be disjoint: no object in the clone may be an original.
  for (const clonedObject of backward.keys()) {
    if (forward.has(clonedObject)) fail("", "the clone graph shares an object with the original graph");
  }
  return visited;
}

// -------------------------------- tests ------------------------------------

// The seed range is fixed and split into batches so no single test runs long.
// A failure message carries the exact seed needed to rebuild that graph.
const BASE_SEED = 0x5eed0001;
const BATCH_COUNT = 5;
const GRAPHS_PER_BATCH = 50;

function cloneGraph(original: unknown, seed: number): unknown {
  try {
    return structuredClone(original);
  } catch (error) {
    throw new Error(`seed ${seed}: structuredClone threw: ${error}`);
  }
}

function portRoundTrip(port1: MessagePort, port2: MessagePort, value: unknown, seed: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    port2.onmessage = event => resolve(event.data);
    port2.onmessageerror = () => reject(new Error(`seed ${seed}: the MessagePort fired messageerror`));
    port1.postMessage(value);
  });
}

function verify(original: unknown, clone: unknown, seed: number): number {
  try {
    return assertSameGraph(original, clone);
  } catch (error) {
    throw new Error(`seed ${seed}: ${(error as Error).message}`);
  }
}

describe("structured clone generative graph fuzz", () => {
  for (let batch = 0; batch < BATCH_COUNT; batch++) {
    const firstSeed = BASE_SEED + batch * GRAPHS_PER_BATCH;
    const lastSeed = firstSeed + GRAPHS_PER_BATCH - 1;

    test(`structuredClone round-trips seeds ${firstSeed}..${lastSeed} with full graph fidelity`, () => {
      let visited = 0;
      for (let seed = firstSeed; seed <= lastSeed; seed++) {
        const original = buildGraph(seed);
        visited += verify(original, cloneGraph(original, seed), seed);
      }
      expect(visited).toBeGreaterThan(GRAPHS_PER_BATCH * 10);
    });

    test(`a MessagePort hop round-trips seeds ${firstSeed}..${lastSeed} with full graph fidelity`, async () => {
      const { port1, port2 } = new MessageChannel();
      try {
        let visited = 0;
        for (let seed = firstSeed; seed <= lastSeed; seed++) {
          const original = buildGraph(seed);
          visited += verify(original, await portRoundTrip(port1, port2, original, seed), seed);
        }
        expect(visited).toBeGreaterThan(GRAPHS_PER_BATCH * 10);
      } finally {
        port1.close();
        port2.close();
      }
    });
  }
});

describe("structurally extreme graphs", () => {
  test("a 1000-deep chain that cycles back to its root round-trips", () => {
    let tail: any = { depth: 0, next: null };
    const root = tail;
    for (let depth = 1; depth < 1000; depth++) tail = tail.next = { depth, next: null };
    tail.next = root;
    expect(assertSameGraph(root, structuredClone(root))).toBeGreaterThanOrEqual(2000);
  });

  test("a 10000-key object round-trips with every key in order", () => {
    const original: Record<string, number> = {};
    for (let i = 0; i < 10_000; i++) original["key_" + i] = i;
    expect(assertSameGraph(original, structuredClone(original))).toBeGreaterThanOrEqual(10_000);
  });

  test("a wide array interleaving fresh objects with shared references round-trips", () => {
    const shared = [{ s: 0 }, { s: 1 }, { s: 2 }];
    const original = Array.from({ length: 10_000 }, (_, i) => (i % 4 === 3 ? { i } : shared[i % 3]));
    expect(assertSameGraph(original, structuredClone(original))).toBeGreaterThanOrEqual(10_000);
  });
});

describe("resizable ArrayBuffer fidelity", () => {
  test("a cloned length-tracking view tracks its own buffer's resize", () => {
    const buffer = new ArrayBuffer(4, { maxByteLength: 32 });
    const clone = structuredClone(new Uint8Array(buffer));
    expect(clone.length).toBe(4);
    expect(clone.buffer.resizable).toBe(true);
    expect(clone.buffer.maxByteLength).toBe(32);
    clone.buffer.resize(20);
    expect(clone.length).toBe(20);
    // The clone's resize must not have touched the original buffer.
    expect(buffer.byteLength).toBe(4);
  });

  test("a cloned fixed-length view over a resizable buffer does not track a resize", () => {
    const buffer = new ArrayBuffer(8, { maxByteLength: 32 });
    const clone = structuredClone(new Uint8Array(buffer, 0, 4));
    expect(clone.length).toBe(4);
    expect(clone.buffer.resizable).toBe(true);
    clone.buffer.resize(24);
    expect(clone.length).toBe(4);
  });
});

describe("values outside the structured clone grammar throw a DataCloneError", () => {
  // https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal
  const cases: [string, () => unknown][] = [
    ["a function", () => () => 1],
    ["a class constructor", () => class Unclonable {}],
    ["a bound function", () => function bound() {}.bind(null)],
    ["a Symbol", () => Symbol("s")],
    ["a boxed Symbol", () => Object(Symbol("s"))],
    ["a WeakMap", () => new WeakMap()],
    ["a WeakSet", () => new WeakSet()],
    ["a WeakRef", () => new WeakRef({})],
    ["a FinalizationRegistry", () => new FinalizationRegistry(() => {})],
    ["a Promise", () => Promise.resolve()],
    ["a Proxy", () => new Proxy({}, {})],
    ["a Proxy whose target is an Array", () => new Proxy([1, 2], {})],
    ["a URL", () => new URL("https://example.com/")],
    [
      "a detached ArrayBuffer nested in an object",
      () => {
        const buffer = new ArrayBuffer(4);
        structuredClone(buffer, { transfer: [buffer] });
        return { nested: buffer };
      },
    ],
    ["a function three levels deep", () => ({ a: { b: { c: () => 1 } } })],
    ["a function reached through a Map value", () => new Map([["k", () => 1]])],
    ["a Symbol reached through a Set", () => new Set([Symbol("s")])],
    [
      "a function reached after a cycle",
      () => {
        const object: any = {};
        object.self = object;
        object.fn = () => 1;
        return object;
      },
    ],
  ];

  test.each(cases)("%s", (_name, make) => {
    const value = make();
    let error: unknown;
    try {
      structuredClone(value);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("DataCloneError");
  });
});

describe("properties the serializer must drop", () => {
  test("symbol-keyed properties are not cloned and their values are never serialized", () => {
    const key = Symbol("hidden");
    const original = {
      visible: 1,
      // An unserializable value: reaching it would throw a DataCloneError.
      [key]: () => 1,
    };
    const clone = structuredClone(original);
    expect(Object.getOwnPropertySymbols(clone)).toEqual([]);
    expect(Object.keys(clone)).toEqual(["visible"]);
  });

  test("non-enumerable properties are not cloned", () => {
    const original = { visible: 1 };
    Object.defineProperty(original, "hidden", { value: 2, enumerable: false });
    expect(Object.keys(structuredClone(original))).toEqual(["visible"]);
  });

  test("own properties added onto an Error are not cloned", () => {
    const original = Object.assign(new TypeError("boom"), { extra: 1 });
    const clone = structuredClone(original);
    expect(clone.name).toBe("TypeError");
    expect(clone.message).toBe("boom");
    expect("extra" in clone).toBe(false);
  });
});

describe("mutation during serialization", () => {
  // The key list is snapshotted up front and each key is re-checked with
  // HasOwnProperty before its getter runs, so a deletion made by an earlier
  // getter is honoured while an addition is not.
  test("a getter that deletes a later sibling removes it from the clone", () => {
    const original = {
      get first() {
        delete (original as any).second;
        return 1;
      },
      second: 2,
    };
    expect(Object.keys(structuredClone(original))).toEqual(["first"]);
  });

  test("a getter that adds a sibling does not add it to the clone", () => {
    const original: any = {
      get first() {
        original.added = 3;
        return 1;
      },
      second: 2,
    };
    expect(Object.keys(structuredClone(original))).toEqual(["first", "second"]);
  });

  test("an index getter that grows the array does not grow the clone", () => {
    const original = [0];
    Object.defineProperty(original, "0", {
      get() {
        original.push(99);
        return 7;
      },
      enumerable: true,
      configurable: true,
    });
    const clone = structuredClone(original);
    expect(clone).toEqual([7]);
    expect(clone.length).toBe(1);
  });

  test("an error thrown by a getter propagates out of structuredClone unchanged", () => {
    const boom = new RangeError("from a getter");
    let caught: unknown;
    try {
      structuredClone({
        get value() {
          throw boom;
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(boom);
  });
});
