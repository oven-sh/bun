// Every kind of value goes to a Worker by postMessage, is described there, comes back and is described again. The same values go through structuredClone on both threads.
class Point {
  x: number;
  y: number;
  #secret = 7;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  get sum(): number {
    return this.x + this.y + this.#secret;
  }
}
class Point3 extends Point {
  z = 3;
  static origin = new Point3(0, 0);
}
class Failure extends Error {
  code = 42;
  name = "Failure";
}
type Pair = { first: number; second: string };

function describe(value: unknown, seen: unknown[] = []): string {
  if (value === null) return "null";
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value.length > 40 ? value.slice(0, 20) + ".." + value.length + ".." + value.slice(-5) : value);
  if (typeof value !== "object") return typeof value === "function" ? "function" : String(value);
  const at = seen.indexOf(value);
  if (at >= 0) return "<seen " + at + ">";
  seen.push(value);
  const prototype = Object.getPrototypeOf(value);
  const tag = prototype === null ? "null-prototype" : (prototype.constructor?.name ?? "?");
  let body = "";
  if (value instanceof Date) body = String(value.getTime());
  else if (value instanceof RegExp) body = value.source + "/" + value.flags + "@" + value.lastIndex;
  else if (value instanceof Number || value instanceof String || value instanceof Boolean || value instanceof BigInt) body = describe(value.valueOf(), seen);
  else if (value instanceof Map) body = [...value].map(([k, v]) => describe(k, seen) + "=>" + describe(v, seen)).join(",");
  else if (value instanceof Set) body = [...value].map(v => describe(v, seen)).join(",");
  else if (value instanceof ArrayBuffer) body = value.byteLength + (value.resizable ? "<" + value.maxByteLength : "") + ":" + [...new Uint8Array(value).slice(0, 8)];
  else if (value instanceof SharedArrayBuffer) body = value.byteLength + (value.growable ? "<" + value.maxByteLength : "") + ":" + [...new Uint8Array(value).slice(0, 8)];
  else if (value instanceof DataView) body = value.byteOffset + "+" + value.byteLength + " of " + describe(value.buffer, seen);
  else if (ArrayBuffer.isView(value)) body = (value as Uint8Array).byteOffset + "+" + (value as Uint8Array).length + ":" + Array.from((value as Uint8Array).slice(0, 8), v => describe(v)).join(",") + " of " + (value as Uint8Array).buffer.byteLength;
  else if (value instanceof Error) body = value.name + ":" + value.message + (typeof value.stack === "string" ? " stack" : " no stack") + ("cause" in value ? " cause " + describe(value.cause, seen) : "") + (value instanceof AggregateError ? " errors " + describe(value.errors, seen) : "");
  else if (value instanceof Blob) body = value.size + ":" + value.type + ((value as File).name !== undefined ? ":" + (value as File).name : "");
  const keys = Reflect.ownKeys(value);
  const own: string[] = [];
  if (Array.isArray(value)) {
    body += "length " + value.length;
    let shown = 0;
    for (const key of keys) {
      if (key === "length") continue;
      if (shown++ > 12) break;
      own.push(String(key) + ":" + describe((value as any)[key], seen));
    }
  } else if (!ArrayBuffer.isView(value) && !(value instanceof String)) {
    for (const key of keys) {
      if (value instanceof Error && (key === "stack" || key === "line" || key === "column" || key === "sourceURL" || key === "originalLine" || key === "originalColumn")) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      own.push(String(key) + ("value" in descriptor ? (descriptor.writable && descriptor.enumerable && descriptor.configurable ? ":" : "(" + +descriptor.writable! + +descriptor.enumerable! + +descriptor.configurable! + "):") + describe(descriptor.value, seen) : ":accessor"));
    }
  }
  return tag + "{" + body + (own.length ? " " + own.join(" ") : "") + "}" + (Object.isFrozen(value) ? "frozen" : Object.isSealed(value) ? "sealed" : Object.isExtensible(value) ? "" : "closed");
}

function values(): [string, () => unknown][] {
  const rope = (n: number) => {
    let text = "";
    for (let i = 0; i < n; i++) text += "part" + i;
    return text;
  };
  const cycle: any = { name: "cycle", list: [] };
  cycle.self = cycle;
  cycle.list.push(cycle, cycle.list);
  const sharedInner = { inner: 1 };
  const buffer = new ArrayBuffer(32);
  new Uint8Array(buffer).set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const pair: Pair = { first: 1, second: "two" };
  const holey = [1, , 3, , 5];
  const sparse: number[] = [];
  sparse[100_000] = 1;
  const withProperty: any = [1, 2, 3];
  withProperty.extra = "x";
  withProperty[-1] = "minus";
  const dictionary: Record<string, number> = {};
  for (let i = 0; i < 200; i++) dictionary["k" + i] = i;
  for (let i = 0; i < 195; i++) delete dictionary["k" + i];
  const deleted: any = new Point(1, 2);
  delete deleted.x;
  const grown: any = new Point(1, 2);
  grown.later = "added";
  const wrongKind: any = new Point(1, 2);
  wrongKind.x = "a text in a number's field";
  const nullPrototype = Object.assign(Object.create(null), { a: 1 });
  const regexp = /a(b)?c/giu;
  regexp.lastIndex = 3;
  const error = new RangeError("out of range", { cause: new TypeError("inner") });
  const failure = new Failure("failed");
  const errorWithProperties: any = new Error("with properties");
  errorWithProperties.code = "E_CODE";
  errorWithProperties.detail = { deep: [1] };
  const bigMap = new Map<number, Pair>();
  for (let i = 0; i < 1000; i++) bigMap.set(i, { first: i, second: "s" + i });
  const deep: any = {};
  for (let i = 0, at = deep; i < 2000; i++) at = at.next = { i };
  return [
    ["undefined", () => undefined],
    ["null", () => null],
    ["booleans", () => [true, false]],
    ["numbers", () => [0, -0, 1, -1, 1.5, NaN, Infinity, -Infinity, 2 ** 31, -(2 ** 31) - 1, 2 ** 53, Number.MIN_VALUE, Number.MAX_VALUE, 4294967295, 1e21]],
    ["an odd NaN", () => new Float64Array(new BigUint64Array([0xfff8_dead_beef_0001n, 0x7ff0_0000_0000_0001n, 0xfffe_0000_0000_0007n]).buffer)],
    ["odd NaNs in a list", () => Array.from(new Float64Array(new BigUint64Array([0xfff8_dead_beef_0001n, 0xfffe_0000_0000_0007n, 0xffff_ffff_ffff_ffffn]).buffer))],
    ["bigints", () => [0n, -1n, 2n ** 64n, -(2n ** 200n), 2n ** 63n - 1n]],
    ["strings", () => ["", "a", "latin1 \xe9", "two bytes 世界", "😀", "\ud800 lone", "\0nul", rope(3), rope(3000), rope(3000).slice(10, 5000), "x".repeat(1 << 20), "length", "constructor", "__proto__"]],
    ["the same string twice", () => { const s = rope(50); return [s, s, { s }]; }],
    ["dates", () => [new Date(0), new Date(8.64e15), new Date(NaN), new Date(2026, 9, 23)]],
    ["regexps", () => [regexp, /(?<year>\d{4})/dv, new RegExp("\\/", "y"), /(?:)/]],
    ["boxed", () => [new Number(-0), new String("boxed"), new Boolean(false), Object(10n), Object.assign(new Number(1), { extra: 1 })]],
    ["lists", () => [[], [1, 2, 3], [1.5, 2.5], ["a", {}], holey, [1.5, , 2.5], [undefined, null], new Array(5), [[[[[]]]]]]],
    ["a sparse list", () => sparse],
    ["a list with properties", () => withProperty],
    ["a long list", () => Array.from({ length: 100_000 }, (_, i) => i)],
    ["a long list of doubles", () => Array.from({ length: 100_000 }, (_, i) => i + 0.5)],
    ["a long list of objects", () => Array.from({ length: 20_000 }, (_, i): Pair => ({ first: i, second: "s" + i })).slice(-3)],
    ["frozen things", () => [Object.freeze([1, 2]), Object.freeze({ a: 1 }), Object.seal({ b: 2 }), Object.preventExtensions({ c: 3 }), Object.freeze(new Point(1, 2))]],
    ["a literal of a declared type", () => pair],
    ["instances", () => [new Point(1, 2), new Point3(4, 5), Point3.origin, deleted, grown, wrongKind]],
    ["a dictionary", () => dictionary],
    ["no prototype", () => nullPrototype],
    ["another prototype", () => Object.create({ inherited: 1 }, { own: { value: 2, enumerable: true }, hidden: { value: 3, enumerable: false } })],
    ["accessors", () => ({ get now() { return "computed"; }, set now(_) {}, plain: 1 })],
    ["an accessor that changes the object", () => { const o: any = { a: 1, get b() { delete o.c; o.d = 4; return 2; }, c: 3 }; return o; }],
    ["symbol keys", () => ({ [Symbol("s")]: 1, [Symbol.iterator]: 2, kept: 3 })],
    ["index keys", () => ({ 1: "a", 0: "b", 4294967295: "c", "-1": "d", "01": "e", 1.5: "f" })],
    ["the name __proto__", () => JSON.parse('{"__proto__": {"polluted": 1}, "a": 1}')],
    ["a cycle", () => cycle],
    ["one object twice", () => [sharedInner, sharedInner, { again: sharedInner }]],
    ["deep", () => { let depth = 0; for (let at = structuredClone(deep); at; at = at.next) depth++; return depth; }],
    ["deep itself", () => deep.next.next],
    ["maps", () => [new Map(), new Map<unknown, unknown>([[1, "a"], ["1", "b"], [NaN, "c"], [-0, "d"], [pair, pair], [null, undefined]]), Object.assign(new Map([[1, 1]]), { extra: 1 })]],
    ["sets", () => [new Set(), new Set<unknown>([1, "1", NaN, -0, pair, null, undefined]), new Set([new Set([new Set()])])]],
    ["a big map", () => [bigMap.size, structuredClone(bigMap).get(999)]],
    ["a big map itself", () => new Map([...bigMap].slice(0, 3))],
    ["a map that holds itself", () => { const m = new Map<unknown, unknown>(); m.set(m, m); m.set("set", new Set([m])); return m; }],
    ["heirs of built-in classes", () => [new (class Stack extends Array<number> { top = 1 })(), new (class Bag extends Map<number, number> { size2 = 2 })([[1, 2]]), new (class Moment extends Date { zone = "utc" })(5), new (class Bytes extends Uint8Array { tag = 1 })(2)]],
    ["buffers", () => [new ArrayBuffer(0), buffer, new ArrayBuffer(8, { maxByteLength: 64 }), buffer.slice(4, 8)]],
    ["views", () => [new Uint8Array(buffer, 1, 4), new Int8Array([-1]), new Uint8ClampedArray([300]), new Int16Array([-2]), new Uint16Array([65535]), new Int32Array([-3]), new Uint32Array([4294967295]), new Float32Array([1.5]), new Float64Array([-0, NaN]), new BigInt64Array([-4n]), new BigUint64Array([2n ** 64n - 1n]), new Float16Array([1.5]), new DataView(buffer, 2, 6)]],
    ["two views of one buffer", () => { const a = new Uint8Array(buffer, 0, 4), b = new Uint16Array(buffer, 4, 2); const [c, d] = structuredClone([a, b]); return [a, b, c.buffer === (d.buffer as unknown)]; }],
    ["a view that follows its buffer", () => new Uint8Array(new ArrayBuffer(8, { maxByteLength: 64 }))],
    ["a Buffer", () => [Buffer.from("text"), Buffer.alloc(3, 1), Buffer.from("a slice of the pool").subarray(2, 7)]],
    ["shared memory", () => [new SharedArrayBuffer(8), new Int32Array(new SharedArrayBuffer(16), 4, 2), new SharedArrayBuffer(8, { maxByteLength: 32 })]],
    ["errors", () => [new Error("plain"), error, new EvalError("e"), new SyntaxError("s"), new URIError("u"), new ReferenceError("r"), new AggregateError([new Error("one"), 2], "many"), failure, errorWithProperties]],
    ["odd errors", () => [Object.assign(new Error("m"), { name: "Custom" }), Object.assign(new Error("m"), { name: "TypeError" }), Object.assign(new Error("m"), { message: 5, stack: 6 }), Object.create(Error.prototype), new DOMException("dom", "AbortError")]],
    ["blobs", () => [new Blob(["abc"], { type: "text/plain" }), new File(["abcd"], "name.txt", { type: "text/x" }), new Blob([])]],
    ["arguments", () => (function (..._: number[]) { return arguments; })(1, 2)],
    ["a function", () => () => 1],
    ["a function inside", () => ({ a: 1, f() {} })],
    ["a class", () => Point],
    ["a bound function", () => describe.bind(null)],
    ["a native function", () => Math.max],
    ["a symbol", () => Symbol("s")],
    ["a symbol inside", () => [Symbol.iterator]],
    ["a weak map", () => new WeakMap()],
    ["a weak set", () => new WeakSet()],
    ["a weak reference", () => new WeakRef({})],
    ["a promise", () => Promise.resolve(1)],
    ["a proxy of an object", () => new Proxy({ a: 1 }, {})],
    ["a proxy of a list", () => new Proxy([1, 2], {})],
    ["a proxy with traps", () => new Proxy({ a: 1 }, { ownKeys: () => ["a", "b"], getOwnPropertyDescriptor: () => ({ value: 9, enumerable: true, configurable: true }), get: () => 8 })],
    ["a generator", () => (function* () {})()],
    ["an iterator", () => [1][Symbol.iterator]()],
    ["a getter that throws", () => ({ get a() { throw new Failure("from the getter"); } })],
    ["Math and JSON", () => [Math, JSON]],
    ["a module namespace", () => import.meta],
    ["host objects", () => [new URL("http://example.com/a?b=c")]],
    ["a URLSearchParams", () => new URLSearchParams("a=1")],
    ["headers", () => new Headers({ a: "1" })],
    ["a request", () => new Request("http://example.com")],
    ["an abort signal", () => new AbortController().signal],
    ["a text encoder", () => new TextEncoder()],
    ["an event", () => new Event("x")],
    ["a crypto key", () => crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, true, ["sign"]).then(() => "made")],
    ["Intl", () => new Intl.NumberFormat("en")],
    ["a detached buffer", () => { const b = new ArrayBuffer(8); structuredClone(b, { transfer: [b] }); return b; }],
    ["a view of a detached buffer", () => { const v = new Uint8Array(8); structuredClone(v.buffer, { transfer: [v.buffer] }); return v; }],
  ];
}

const attempt = (make: () => unknown): string => {
  try {
    return describe(make());
  } catch (error) {
    return "THROWS " + (error as Error).name + ": " + (error as Error).message;
  }
};

if (Bun.isMainThread) {
  const worker = new Worker(new URL(import.meta.url));
  const ask = (message: unknown) =>
    new Promise<any>((resolve, reject) => {
      worker.onmessage = event => resolve(event.data);
      worker.onmessageerror = () => resolve({ there: "messageerror", back: undefined });
      try {
        worker.postMessage(message);
      } catch (error) {
        reject(error);
      }
    });
  const all = values();
  for (let index = 0; index < all.length; index++) {
    const [name, make] = all[index];
    console.log(name);
    console.log("  here    ", attempt(make));
    console.log("  cloned  ", attempt(() => structuredClone(make())));
    try {
      const answer = await ask({ index, value: make() });
      console.log("  there   ", answer.there);
      console.log("  back    ", attempt(() => answer.back));
      console.log("  made there", attempt(() => answer.made));
    } catch (error) {
      console.log("  posting THROWS", (error as Error).name + ": " + (error as Error).message);
    }
  }
  worker.terminate();
} else {
  const all = values();
  addEventListener("message", (event: MessageEvent<{ index: number; value: unknown }>) => {
    const there = describe(event.data.value);
    let made: unknown;
    try {
      made = all[event.data.index][1]();
      structuredClone(made);
    } catch (error) {
      made = "THROWS there " + (error as Error).name;
    }
    postMessage({ there, back: event.data.value, made });
  });
}
