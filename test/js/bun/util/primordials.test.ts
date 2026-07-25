import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// JSC exposes tamper-proof references to the original builtins ("primordials",
// JSCPrimordials.h) to Bun's builtin JavaScript as `$Name` link-time constants.
// `bun:internal-for-testing`'s primordials.audit() materializes all of them and
// returns { name, holder, kind, key, value, available } per entry, so every check
// below iterates the full manifest instead of a hand-picked subset. Each scenario
// runs in a child process because it mutates globals.
//
// Everything a child script does after it starts tampering must itself be immune
// to the tampering: helpers are captured in the prelude, loops are index-based (no
// array iterators), descriptors are null-prototype objects, and reports are built
// with the captured JSON.stringify.

const prelude = /* js */ `
  const { primordials } = require("bun:internal-for-testing");
  const audit = primordials.audit;
  const write = process.stdout.write.bind(process.stdout);
  const exit = process.exit.bind(process);
  const stringify = JSON.stringify;
  const report = (obj) => write(stringify(obj) + "\\n");
  // For the tampering scenarios: Bun's own builtin JS is not primordial-hardened
  // yet, so a normal shutdown after tampering can throw; report, then exit.
  const reportAndExit = (obj) => { report(obj); exit(0); };
  const ownDesc = Object.getOwnPropertyDescriptor;
  const getProto = Object.getPrototypeOf;
  const setProto = Object.setPrototypeOf;
  const defineProperty = Object.defineProperty;
  const seal = Object.seal;
  const freeze = Object.freeze;
  const objectKeys = Object.keys;
  const ownKeys = Reflect.ownKeys;
  const reflectSet = Reflect.set;
  const $apply = Reflect.apply;
  function protoOf(f) { return getProto(f()); }
  const holderFactories = {
    ObjectPrototype: () => Object.prototype,
    ObjectConstructor: () => Object,
    FunctionPrototype: () => Function.prototype,
    ArrayPrototype: () => Array.prototype,
    ArrayConstructor: () => Array,
    StringPrototype: () => String.prototype,
    StringConstructor: () => String,
    RegExpPrototype: () => RegExp.prototype,
    SymbolPrototype: () => Symbol.prototype,
    SymbolConstructor: () => Symbol,
    BigIntPrototype: () => BigInt.prototype,
    BigIntConstructor: () => BigInt,
    PromisePrototype: () => Promise.prototype,
    PromiseConstructor: () => Promise,
    IteratorPrototype: () => Iterator.prototype,
    IteratorConstructor: () => Iterator,
    ArrayIteratorPrototype: () => protoOf(() => [][Symbol.iterator]()),
    StringIteratorPrototype: () => protoOf(() => ""[Symbol.iterator]()),
    MapIteratorPrototype: () => protoOf(() => new Map()[Symbol.iterator]()),
    SetIteratorPrototype: () => protoOf(() => new Set()[Symbol.iterator]()),
    RegExpStringIteratorPrototype: () => protoOf(() => "a".matchAll(/a/g)),
    IteratorHelperPrototype: () => protoOf(() => [].values().map(x => x)),
    WrapForValidIteratorPrototype: () => protoOf(() => Iterator.from({ next() { return { done: true }; } })),
    AsyncIteratorPrototype: () => getProto(getProto(protoOf(() => (async function* () {})()))),
    WeakRefPrototype: () => WeakRef.prototype,
    FinalizationRegistryPrototype: () => FinalizationRegistry.prototype,
    GlobalFunctions: () => globalThis,
    BooleanPrototype: () => Boolean.prototype,
    BooleanConstructor: () => Boolean,
    DatePrototype: () => Date.prototype,
    DateConstructor: () => Date,
    ErrorPrototype: () => Error.prototype,
    ErrorConstructor: () => Error,
    MapPrototype: () => Map.prototype,
    MapConstructor: () => Map,
    NumberPrototype: () => Number.prototype,
    NumberConstructor: () => Number,
    SetPrototype: () => Set.prototype,
    SetConstructor: () => Set,
    WeakMapPrototype: () => WeakMap.prototype,
    WeakMapConstructor: () => WeakMap,
    WeakSetPrototype: () => WeakSet.prototype,
    WeakSetConstructor: () => WeakSet,
    JSArrayBufferPrototype: () => ArrayBuffer.prototype,
    JSArrayBufferConstructor: () => ArrayBuffer,
    TypedArrayPrototype: () => getProto(Uint8Array.prototype),
    TypedArrayConstructor: () => getProto(Uint8Array),
    DataViewPrototype: () => DataView.prototype,
    MathObject: () => Math,
    JSONObject: () => JSON,
    ReflectObject: () => Reflect,
    AtomicsObject: () => Atomics,
  };
  const holderNames = objectKeys(holderFactories);
  // Resolved lazily (some tests must not touch holders early) and memoized.
  const holderObjects = { __proto__: null };
  function resolveHolder(name) {
    if (!(name in holderObjects)) holderObjects[name] = holderFactories[name]();
    return holderObjects[name];
  }
  function resolveAllHolders() { for (let i = 0; i < holderNames.length; i++) resolveHolder(holderNames[i]); }
  // The entry's current value read the way user code reads it (accessor kinds → the getter).
  function liveValue(row) {
    const holder = resolveHolder(row.holder);
    if (row.kind === "Getter" || row.kind === "SymbolGetter") return ownDesc(holder, row.key).get;
    return holder[row.key];
  }
`;

async function runChild(body: string, env: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", prelude + body],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("primordials manifest", () => {
  test("src/js/primordials.d.ts matches the engine's primordial names", async () => {
    // The .d.ts is generated from JSCPrimordials.h (src/codegen/generate-primordials-dts.ts);
    // this catches a WebKit upgrade whose table changed without a regeneration.
    const dts = await Bun.file(new URL("../../../../src/js/primordials.d.ts", import.meta.url)).text();
    const declared = [...dts.matchAll(/^declare const \$(\w+):/gm)].map(m => m[1]).sort();
    const { stdout, stderr, exitCode } = await runChild(/* js */ `
      const rows = audit();
      const names = [];
      for (let i = 0; i < rows.length; i++) names[i] = rows[i].name;
      names.sort();
      report({ names });
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout).names).toEqual(declared);
    expect(exitCode).toBe(0);
  });

  test("covers every holder in JSCPrimordials.h and every value is a function", async () => {
    const { stdout, stderr, exitCode } = await runChild(/* js */ `
      const rows = audit();
      const unknownHolders = [], notFunction = [], unavailable = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!(row.holder in holderFactories)) unknownHolders[unknownHolders.length] = row.holder;
        if (typeof row.value !== "function") notFunction[notFunction.length] = row.name;
        if (!row.available) unavailable[unavailable.length] = row.name;
      }
      report({ count: rows.length, unknownHolders, notFunction, unavailable });
    `);
    expect(stderr).toBe("");
    const report = JSON.parse(stdout);
    expect(report).toEqual({ count: report.count, unknownHolders: [], notFunction: [], unavailable: [] });
    expect(report.count).toBeGreaterThan(400);
    expect(exitCode).toBe(0);
  });

  test("every primordial is identical to the live builtin in an untouched global", async () => {
    // Materialize first (nothing touched yet), then compare: exercises the lazy
    // link-time path that reifies static properties for identity.
    const { stdout, stderr, exitCode } = await runChild(/* js */ `
      const rows = audit();
      const mismatched = [];
      for (let i = 0; i < rows.length; i++) if (rows[i].value !== liveValue(rows[i])) mismatched[mismatched.length] = rows[i].name;
      report({ mismatched });
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ mismatched: [] });
    expect(exitCode).toBe(0);
  });

  test("identity also holds when the builtins were touched before any primordial linked", async () => {
    const { stdout, stderr, exitCode } = await runChild(/* js */ `
      // Read every own property of every holder first, like user code that ran earlier.
      resolveAllHolders();
      for (let i = 0; i < holderNames.length; i++) {
        const holder = holderObjects[holderNames[i]];
        const keys = ownKeys(holder);
        for (let k = 0; k < keys.length; k++) ownDesc(holder, keys[k]);
      }
      const rows = audit();
      const mismatched = [];
      for (let i = 0; i < rows.length; i++) if (rows[i].value !== liveValue(rows[i])) mismatched[mismatched.length] = rows[i].name;
      report({ mismatched });
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ mismatched: [] });
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("primordials survive tampering", () => {
  // Snapshot pristine values, tamper with every entry in every listed way, then
  // audit: each primordial must still be the pristine function.
  test("direct and roundabout tampering of every entry after the builtins exist", async () => {
    const { stdout, stderr, exitCode } = await runChild(/* js */ `
      const rows = audit();
      resolveAllHolders();
      const pristine = { __proto__: null };
      for (let i = 0; i < rows.length; i++) pristine[rows[i].name] = liveValue(rows[i]);
      const poison = function poisoned() { return "poisoned"; };
      const canaryBefore = holderObjects.ArrayPrototype.push;

      // 1. Plain assignment, Reflect.set, and defineProperty (value + accessor) on every key.
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i], holder = holderObjects[row.holder];
        const tagged = function tampered() { return "tampered " + row.name; };
        try { holder[row.key] = tagged; } catch {}
        try { reflectSet(holder, row.key, tagged); } catch {}
        try { defineProperty(holder, row.key, { __proto__: null, value: tagged, configurable: true, writable: true }); } catch {}
        try { defineProperty(holder, row.key, { __proto__: null, get() { return "tampered getter " + row.name; }, configurable: true }); } catch {}
      }
      // 2. Delete every key and plant the same names where a prototype-chain walk would find them.
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try { delete holderObjects[row.holder][row.key]; } catch {}
        try { defineProperty(Object.prototype, row.key, { __proto__: null, value: poison, configurable: true, writable: true }); } catch {}
        try { defineProperty(Function.prototype, row.key, { __proto__: null, value: poison, configurable: true, writable: true }); } catch {}
      }
      // 3. Structural attacks on the holders themselves.
      for (let i = 0; i < holderNames.length; i++) {
        const holder = holderObjects[holderNames[i]];
        if (holder === globalThis) continue;
        try { setProto(holder, { __proto__: null, get poisonedProto() { return "poisoned proto"; } }); } catch {}
        try { holder.constructor = poison; } catch {}
        try { seal(holder); } catch {}
        try { freeze(holder); } catch {}
      }
      // 4. Replace the global bindings themselves.
      const globals = ["Object","Function","Array","String","RegExp","Symbol","BigInt","Promise","Iterator","WeakRef","FinalizationRegistry",
                       "Boolean","Date","Error","Map","Number","Set","WeakMap","WeakSet","ArrayBuffer","DataView","Uint8Array",
                       "Math","JSON","Reflect","Atomics","escape","unescape","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent"];
      for (let i = 0; i < globals.length; i++) {
        try { defineProperty(globalThis, globals[i], { __proto__: null, value: poison, configurable: true, writable: true }); } catch {}
      }

      const after = audit();
      // String accumulator + null-prototype report: JSON.stringify would otherwise
      // observe the toJSON planted on Object.prototype (spec-correct behavior).
      let changed = "";
      for (let i = 0; i < after.length; i++) if (after[i].value !== pristine[after[i].name]) changed += (changed ? "," : "") + after[i].name;
      reportAndExit({ __proto__: null, changed, tampered: holderObjects.ArrayPrototype.push !== canaryBefore });
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ changed: "", tampered: true });
    expect(exitCode).toBe(0);
  });

  test("pollution planted before any lazy holder exists is never captured", async () => {
    // Nothing has touched Map/Set/Date/Math/JSON/... yet in this process, so this
    // targets the lazy creation snapshots and the static-table materialization path.
    const { stdout, stderr, exitCode } = await runChild(/* js */ `
      const planted = [];
      function plant(target, key, fn) {
        planted[planted.length] = fn;
        try { defineProperty(target, key, { __proto__: null, value: fn, configurable: true, writable: true }); } catch {}
      }
      // Every kind of primordial key, planted on the chain a naive lookup would walk.
      const keys = ["hasOwnProperty","toString","valueOf","assign","keys","freeze","apply","bind","call","push","map","slice",
                    "charAt","split","exec","test","get","set","has","size","now","parse","stringify","abs","max","ownKeys",
                    "add","load","then","catch","from","of","for","keyFor","asIntN","next","register","deref","drop",
                    "toArray","getBigInt64","byteLength","buffer","length","subarray","escape","decodeURI",
                    "encodeURIComponent","description","isRawJSON","rawJSON","captureStackTrace","isError","groupBy"];
      for (let i = 0; i < keys.length; i++) {
        plant(Object.prototype, keys[i], function plantedOnObject() { return "planted"; });
        plant(Function.prototype, keys[i], function plantedOnFunction() { return "planted"; });
      }
      // Replace / redefine namespace and constructor bindings before their first use.
      plant(globalThis, "Math", { max: () => "planted" });
      plant(globalThis, "Reflect", new Proxy({}, { get: () => () => "planted" }));
      delete globalThis.JSON;
      globalThis.Atomics = { load: () => "planted" };
      const ctors = ["Map","Set","WeakMap","WeakSet","Date","Error","Number","Boolean","ArrayBuffer","DataView"];
      for (let i = 0; i < ctors.length; i++) plant(globalThis, ctors[i], function plantedCtor() { return "planted"; });

      const rows = audit();
      const captured = [], unavailable = [];
      for (let i = 0; i < rows.length; i++) {
        if (!rows[i].available) unavailable[unavailable.length] = rows[i].name;
        for (let p = 0; p < planted.length; p++) if (rows[i].value === planted[p]) captured[captured.length] = rows[i].name;
      }
      const value = { __proto__: null };
      for (let i = 0; i < rows.length; i++) value[rows[i].name] = rows[i].value;
      // Behavioral spot checks on the lazily-created holders, using receivers that
      // don't depend on the replaced globals.
      const behavior = {
        MathMax: value.MathMax(1, 5, 3),
        ReflectOwnKeys: value.ReflectOwnKeys({ a: 1 }).length,
        JSONStringify: value.JSONStringify({ a: 1 }),
        AtomicsLoad: value.AtomicsLoad(new Int32Array(1), 0),
        DateNow: typeof value.DateNow(),
        NumberIsInteger: value.NumberIsInteger(3),
        ErrorIsError: value.ErrorIsError(new TypeError("x")) === true && value.ErrorIsError({}) === false,
      };
      reportAndExit({ captured, unavailable, behavior });
    `);
    expect(stderr).toBe("");
    const report = JSON.parse(stdout);
    expect(report.captured).toEqual([]);
    expect(report.unavailable).toEqual([]);
    expect(report.behavior).toEqual({
      MathMax: 5,
      ReflectOwnKeys: 1,
      JSONStringify: '{"a":1}',
      AtomicsLoad: 0,
      DateNow: "number",
      NumberIsInteger: true,
      ErrorIsError: true,
    });
    expect(exitCode).toBe(0);
  });

  test("primitive-valued global bindings before first use don't break materialization", async () => {
    // Namespace/constructor bindings replaced with non-objects before anything links:
    // the holders must be recreated pristine instead of downcasting a primitive.
    const { stdout, stderr, exitCode } = await runChild(/* js */ `
      globalThis.Math = 5;
      globalThis.JSON = 0;
      globalThis.Reflect = undefined;
      globalThis.Atomics = "atomics";
      globalThis.Map = false;
      globalThis.Error = 1;
      const rows = audit();
      const unavailable = [];
      for (let i = 0; i < rows.length; i++) if (!rows[i].available) unavailable[unavailable.length] = rows[i].name;
      const value = { __proto__: null };
      for (let i = 0; i < rows.length; i++) value[rows[i].name] = rows[i].value;
      reportAndExit({
        unavailable,
        MathMax: value.MathMax(1, 5, 3),
        JSONStringify: value.JSONStringify({ a: 1 }),
        ReflectHas: value.ReflectHas({ a: 1 }, "a"),
        AtomicsLoad: value.AtomicsLoad(new Int32Array(1), 0),
        ErrorIsError: value.ErrorIsError(new TypeError("x")),
      });
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      unavailable: [],
      MathMax: 5,
      JSONStringify: '{"a":1}',
      ReflectHas: true,
      AtomicsLoad: 0,
      ErrorIsError: true,
    });
    expect(exitCode).toBe(0);
  });

  test("a foreign realm's namespace objects are never adopted as this realm's holders", async () => {
    const { stdout, stderr, exitCode } = await runChild(/* js */ `
      const vm = require("node:vm");
      const foreign = vm.runInNewContext("({ Math, JSON, Reflect, Atomics })");
      globalThis.Math = foreign.Math;
      globalThis.JSON = foreign.JSON;
      globalThis.Reflect = foreign.Reflect;
      globalThis.Atomics = foreign.Atomics;
      const rows = audit();
      const value = { __proto__: null };
      const unavailable = [];
      for (let i = 0; i < rows.length; i++) {
        value[rows[i].name] = rows[i].value;
        if (!rows[i].available) unavailable[unavailable.length] = rows[i].name;
      }
      report({
        unavailable,
        foreign: value.MathMax === foreign.Math.max || value.JSONStringify === foreign.JSON.stringify,
        MathMax: value.MathMax(1, 5, 3),
        JSONStringify: value.JSONStringify({ a: 1 }),
        ReflectHas: value.ReflectHas({ a: 1 }, "a"),
        AtomicsLoad: value.AtomicsLoad(new Int32Array(1), 0),
      });
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      unavailable: [],
      foreign: false,
      MathMax: 5,
      JSONStringify: '{"a":1}',
      ReflectHas: true,
      AtomicsLoad: 0,
    });
    expect(exitCode).toBe(0);
  });

  test("tampered builtins still work through their primordials", async () => {
    // Behavior, not just identity: call methods and getters from every holder on
    // receivers created before tampering, after every primordial key on every holder
    // (including Function.prototype.call/apply) has been replaced with a thrower.
    const { stdout, stderr, exitCode } = await runChild(/* js */ `
      const map = new Map([["k", "v"]]); const set = new Set([1]); const u8 = new Uint8Array([1, 2, 3, 4]);
      const dv = new DataView(u8.buffer); const date = new Date(0); const re = /b/g; const err = new Error("e");
      const wr = new WeakRef({}); const wm = new WeakMap(); const ws = new WeakSet(); const sym = Symbol("s");
      const promise = Promise.resolve(1);
      const rows = audit();
      resolveAllHolders();
      const v = { __proto__: null };
      for (let i = 0; i < rows.length; i++) v[rows[i].name] = rows[i].value;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try { defineProperty(holderObjects[row.holder], row.key, { __proto__: null, value() { return "tampered " + row.name; }, configurable: true }); } catch {}
      }
      const join = (arr) => $apply(v.ArrayPrototypeJoin, arr, [","]);
      const results = {
        ArrayPrototypeMap: join($apply(v.ArrayPrototypeMap, [1, 2], [x => x * 2])),
        ArrayIteratorNext: $apply(v.ArrayIteratorPrototypeNext, $apply(v.ArrayPrototypeSymbolIterator, [7], []), []).value,
        StringPrototypeSlice: $apply(v.StringPrototypeSlice, "hello", [1, 3]),
        StringIteratorNext: $apply(v.StringIteratorPrototypeNext, $apply(v.StringPrototypeSymbolIterator, "hi", []), []).value,
        ObjectKeys: join(v.ObjectKeys({ a: 1, b: 2 })),
        ObjectPrototypeHasOwnProperty: $apply(v.ObjectPrototypeHasOwnProperty, { a: 1 }, ["a"]),
        FunctionPrototypeCall: $apply(v.FunctionPrototypeCall, function () { return this.x; }, [{ x: 42 }]),
        RegExpPrototypeExec: $apply(v.RegExpPrototypeExec, re, ["abc"])[0],
        RegExpPrototypeGetGlobal: $apply(v.RegExpPrototypeGetGlobal, re, []),
        SymbolPrototypeGetDescription: $apply(v.SymbolPrototypeGetDescription, sym, []),
        SymbolFor: typeof v.SymbolFor("k"),
        BigIntPrototypeToString: $apply(v.BigIntPrototypeToString, 255n, [16]),
        BigIntAsIntN: v.BigIntAsIntN(8, 255n) === -1n,
        PromisePrototypeThen: typeof $apply(v.PromisePrototypeThen, promise, [x => x]),
        PromiseResolve: typeof $apply(v.PromiseResolve, Promise, [2]),
        MapPrototypeGet: $apply(v.MapPrototypeGet, map, ["k"]),
        MapPrototypeGetSize: $apply(v.MapPrototypeGetSize, map, []),
        SetPrototypeHas: $apply(v.SetPrototypeHas, set, [1]),
        WeakMapPrototypeHas: $apply(v.WeakMapPrototypeHas, wm, [{}]),
        WeakSetPrototypeHas: $apply(v.WeakSetPrototypeHas, ws, [{}]),
        WeakRefPrototypeDeref: typeof $apply(v.WeakRefPrototypeDeref, wr, []),
        DatePrototypeGetTime: $apply(v.DatePrototypeGetTime, date, []),
        DateNow: typeof v.DateNow(),
        ErrorPrototypeToString: $apply(v.ErrorPrototypeToString, err, []),
        ErrorCaptureStackTrace: (v.ErrorCaptureStackTrace(err), typeof err.stack),
        ErrorIsError: v.ErrorIsError(err),
        NumberPrototypeToFixed: $apply(v.NumberPrototypeToFixed, 1.25, [1]),
        NumberParseInt: v.NumberParseInt("42px"),
        BooleanPrototypeToString: $apply(v.BooleanPrototypeToString, true, []),
        TypedArrayPrototypeGetLength: $apply(v.TypedArrayPrototypeGetLength, u8, []),
        TypedArrayPrototypeSubarray: $apply(v.TypedArrayPrototypeGetLength, $apply(v.TypedArrayPrototypeSubarray, u8, [1, 3]), []),
        ArrayBufferPrototypeGetByteLength: $apply(v.ArrayBufferPrototypeGetByteLength, $apply(v.TypedArrayPrototypeGetBuffer, u8, []), []),
        DataViewPrototypeGetUint8: $apply(v.DataViewPrototypeGetUint8, dv, [2]),
        MathMax: v.MathMax(1, 5, 3),
        JSONParse: v.JSONParse("[1,2]").length,
        JSONStringify: v.JSONStringify({ a: 1 }),
        ReflectHas: v.ReflectHas({ a: 1 }, "a"),
        AtomicsAdd: v.AtomicsAdd(new Int32Array(2), 0, 5),
        globalEncodeURIComponent: v.globalEncodeURIComponent("a b"),
        StringFromCharCode: v.StringFromCharCode(104, 105),
        FinalizationRegistryPrototypeRegister: typeof $apply(v.FinalizationRegistryPrototypeRegister, new FinalizationRegistry(() => {}), [{}, 1]),
      };
      reportAndExit(results);
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      ArrayPrototypeMap: "2,4",
      ArrayIteratorNext: 7,
      StringPrototypeSlice: "el",
      StringIteratorNext: "h",
      ObjectKeys: "a,b",
      ObjectPrototypeHasOwnProperty: true,
      FunctionPrototypeCall: 42,
      RegExpPrototypeExec: "b",
      RegExpPrototypeGetGlobal: true,
      SymbolPrototypeGetDescription: "s",
      SymbolFor: "symbol",
      BigIntPrototypeToString: "ff",
      BigIntAsIntN: true,
      PromisePrototypeThen: "object",
      PromiseResolve: "object",
      MapPrototypeGet: "v",
      MapPrototypeGetSize: 1,
      SetPrototypeHas: true,
      WeakMapPrototypeHas: false,
      WeakSetPrototypeHas: false,
      WeakRefPrototypeDeref: "object",
      DatePrototypeGetTime: 0,
      DateNow: "number",
      ErrorPrototypeToString: "Error: e",
      ErrorCaptureStackTrace: "string",
      ErrorIsError: true,
      NumberPrototypeToFixed: "1.3",
      NumberParseInt: 42,
      BooleanPrototypeToString: "true",
      TypedArrayPrototypeGetLength: 4,
      TypedArrayPrototypeSubarray: 2,
      ArrayBufferPrototypeGetByteLength: 4,
      DataViewPrototypeGetUint8: 3,
      MathMax: 5,
      JSONParse: 2,
      JSONStringify: '{"a":1}',
      ReflectHas: true,
      AtomicsAdd: 0,
      globalEncodeURIComponent: "a%20b",
      StringFromCharCode: "hi",
      FinalizationRegistryPrototypeRegister: "undefined",
    });
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("primordials configuration", () => {
  test("option-gated builtins that don't exist become throwing placeholders, not crashes or pollution", async () => {
    // JSON.isRawJSON / JSON.rawJSON only exist with --useJSONSourceTextAccess.
    // Turn it off, plant the names on Object.prototype, and touch JSON: the
    // primordials must be "unavailable" throwers rather than the planted functions.
    const { stdout, stderr, exitCode } = await runChild(
      /* js */ `
      const planted = function planted() { return "planted"; };
      Object.prototype.isRawJSON = planted;
      Object.prototype.rawJSON = planted;
      JSON.parse("1");
      const rows = audit();
      const unavailable = [], captured = [];
      for (let i = 0; i < rows.length; i++) {
        if (!rows[i].available) unavailable[unavailable.length] = rows[i].name;
        if (rows[i].value === planted) captured[captured.length] = rows[i].name;
      }
      unavailable.sort();
      let threw = false;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].name !== "JSONIsRawJSON") continue;
        try { rows[i].value(); } catch (e) { threw = /not available/.test(String(e)); }
      }
      reportAndExit({ unavailable, captured, threw });
    `,
      { BUN_JSC_useJSONSourceTextAccess: "0" },
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ unavailable: ["JSONIsRawJSON", "JSONRawJSON"], captured: [], threw: true });
    expect(exitCode).toBe(0);
  });

  // Debug+ASAN Worker startup plus a full audit() regularly exceeds the 5 s default under describe.concurrent.
  test("each Worker global materializes its own primordials", { timeout: 30_000 }, async () => {
    const { stdout, stderr, exitCode } = await runChild(/* js */ `
      const { Worker } = require("node:worker_threads");
      const w = new Worker(
        'Array.prototype.push = () => { throw new Error("worker tampered"); };' +
        'const { primordials } = require("bun:internal-for-testing");' +
        'const rows = primordials.audit();' +
        'let push, unavailable = 0;' +
        'for (let i = 0; i < rows.length; i++) { if (rows[i].name === "ArrayPrototypePush") push = rows[i].value; if (!rows[i].available) unavailable++; }' +
        'const arr = []; push.call(arr, 1, 2);' +
        'require("node:worker_threads").parentPort.postMessage({ len: arr.length, unavailable });',
        { eval: true }
      );
      let posted = false;
      w.on("message", m => { posted = true; write(stringify(m)); w.terminate(); });
      w.on("error", e => { process.stderr.write(String(e)); process.exit(1); });
      w.on("exit", code => { if (!posted) { process.stderr.write("worker exited " + code + " without posting"); process.exit(1); } });
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ len: 2, unavailable: 0 });
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("$Name link-time constants in builtin JavaScript", () => {
  // The bundler rewrites $Name to @Name and .$call to a direct call; drive the
  // checked-in probe through a poisoned global to make sure that path is used.
  const probeBody = /* js */ `
    const map = new Map([["k", "v"]]);
    const u8 = new Uint8Array([1, 2, 3, 4]);
    const originalPush = Array.prototype.push;
    if (process.env.TAMPER === "1") {
      Array.prototype.push = () => { throw new Error("tampered"); };
      Array.prototype.slice = () => { throw new Error("tampered"); };
      Array.prototype[Symbol.iterator] = () => { throw new Error("tampered"); };
      String.prototype.slice = () => { throw new Error("tampered"); };
      String.prototype.split = () => { throw new Error("tampered"); };
      Object.keys = () => { throw new Error("tampered"); };
      Object.defineProperty = () => { throw new Error("tampered"); };
      Function.prototype.bind = () => { throw new Error("tampered"); };
      Function.prototype.call = () => { throw new Error("tampered"); };
      Function.prototype.apply = () => { throw new Error("tampered"); };
      RegExp.prototype.test = () => { throw new Error("tampered"); };
      Map.prototype.get = () => { throw new Error("tampered"); };
      Date.now = () => { throw new Error("tampered"); };
      Number.isInteger = () => { throw new Error("tampered"); };
      Math.max = () => { throw new Error("tampered"); };
      Reflect.ownKeys = () => { throw new Error("tampered"); };
      JSON.stringify = () => { throw new Error("tampered"); };
      const TA = Reflect.getPrototypeOf(Uint8Array.prototype);
      TA.subarray = () => { throw new Error("tampered"); };
      defineProperty(Map.prototype, "size", { get() { throw new Error("tampered"); } });
      defineProperty(TA, "length", { get() { throw new Error("tampered"); } });
      defineProperty(DataView.prototype, "byteLength", { get() { throw new Error("tampered"); } });
      defineProperty(RegExp.prototype, "source", { get() { throw new Error("tampered"); } });
      Promise.resolve = () => { throw new Error("tampered"); };
    }
    const out = primordials.run([], "hello", map, u8, /ell/);
    out.tampered = Array.prototype.push !== originalPush;
    reportAndExit(out);
  `;

  const expected = {
    ArrayPrototypePush: 2,
    ArrayPrototypeSlice: [1, 2],
    ArrayPrototypeSymbolIterator: 1,
    StringPrototypeSlice: "el",
    StringPrototypeSplit: ["h", "e", "l", "l", "o"],
    ObjectKeys: ["a", "b"],
    ObjectDefineProperty: 42,
    FunctionPrototypeBind: 8,
    RegExpPrototypeTest: true,
    RegExpPrototypeGetSource: "ell",
    MapPrototypeGet: "v",
    MapPrototypeGetSize: 1,
    DateNow: "number",
    NumberIsInteger: true,
    MathMax: 5,
    ReflectOwnKeys: ["a"],
    JSONStringify: '{"a":1}',
    TypedArrayPrototypeGetLength: 4,
    TypedArrayPrototypeSubarray: 2,
    DataViewPrototypeGetByteLength: 4,
    PromiseResolve: true,
  };

  for (const tamper of [false, true]) {
    test(tamper ? "after tampering" : "untouched", async () => {
      const { stdout, stderr, exitCode } = await runChild(probeBody, { TAMPER: tamper ? "1" : "0" });
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ ...expected, tampered: tamper });
      expect(exitCode).toBe(0);
    });
  }
});
