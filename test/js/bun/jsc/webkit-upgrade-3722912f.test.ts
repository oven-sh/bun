import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Coverage for the WebKit 3722912ff800 sync (oven-sh/WebKit#383). Each case
// pins an observable behavior difference so the gate can distinguish the old
// JSC from the new one, and the re-export cases exercise the
// ScriptFetchParameters::Type threading added to BunAnalyzeTranspiledModule.

describe.concurrent("WebKit 3722912ff800 upgrade", () => {
  test("Iterator.prototype.includes is enabled by default (319f94b3db4a)", () => {
    expect(typeof Iterator.prototype.includes).toBe("function");
    function* g() {
      yield 1;
      yield 2;
      yield 3;
    }
    expect(g().includes(2)).toBe(true);
    expect(g().includes(5)).toBe(false);
  });

  test("cyclic Array.prototype.join returns the empty string for the cycle (oven-sh/WebKit#559)", () => {
    // Upstream removed StringRecursionChecker in f2f2c2ddf637; oven-sh/WebKit#559
    // restores it for the array conversions so a self-containing array matches
    // V8 instead of throwing RangeError (oven-sh/bun#41198).
    const a: unknown[] = [1, null, 2];
    a[1] = a;
    expect(a.join()).toBe("1,,2");
    expect(a.toString()).toBe("1,,2");
    expect(a.toLocaleString()).toBe("1,,2");
    expect(`${a}`).toBe("1,,2");
  });

  test("JSON.stringify fast path honors a non-enumerable own toJSON (8b9071b24ead, 9f9370cc729f)", () => {
    // SerializeJSONProperty looks toJSON up with GetV, so enumerability is
    // irrelevant. FastStringifier used to skip DontEnum entries before looking
    // for it and serialized the object's own properties instead.
    function withToJSON<T extends object>(object: T, toJSON: unknown): T {
      Object.defineProperty(object, "toJSON", {
        value: toJSON,
        enumerable: false,
        writable: false,
        configurable: false,
      });
      return object;
    }
    const frozen = Object.freeze(
      withToJSON({ uri: "u", cid: "c", text: "t" }, function (this: { uri: string; cid: string }) {
        return { uri: this.uri, cid: this.cid };
      }),
    );
    const plain = withToJSON({ a: 1, b: 2 }, () => "via toJSON");

    expect({
      frozen: JSON.stringify(frozen),
      frozenNested: JSON.stringify({ record: frozen }),
      frozenInArray: JSON.stringify([frozen]),
      frozenWithGap: JSON.stringify(frozen, null, 2),
      plain: JSON.stringify(plain),
      plainNested: JSON.stringify({ plain }),
      plainWithGap: JSON.stringify({ plain }, null, 1),
      receivesKey: JSON.stringify({ key: withToJSON({ a: 1 }, (key: string) => key) }),
      returnsUndefined: JSON.stringify(withToJSON({ a: 1 }, () => undefined)),
      notCallable: JSON.stringify(withToJSON({ a: 1 }, 42)),
      enumerable: JSON.stringify({ a: 1, toJSON: () => "enumerable" }),
      enumerableNotCallable: JSON.stringify({ a: 1, toJSON: 42 }),
    }).toEqual({
      frozen: '{"uri":"u","cid":"c"}',
      frozenNested: '{"record":{"uri":"u","cid":"c"}}',
      frozenInArray: '[{"uri":"u","cid":"c"}]',
      frozenWithGap: '{\n  "uri": "u",\n  "cid": "c"\n}',
      plain: '"via toJSON"',
      plainNested: '{"plain":"via toJSON"}',
      plainWithGap: '{\n "plain": "via toJSON"\n}',
      receivesKey: '{"key":"key"}',
      returnsUndefined: undefined,
      notCallable: '{"a":1}',
      enumerable: '"enumerable"',
      enumerableNotCallable: '{"a":1,"toJSON":42}',
    });

    // Big enough to leave FastStringifier's static buffer for the dynamic one.
    const many = Array.from({ length: 2000 }, (_, i) => withToJSON({ index: i, name: "name" + i }, () => i));
    expect(JSON.stringify(many)).toBe("[" + many.map((_, i) => i).join(",") + "]");
  });

  test("JSON.stringify fast path honors toJSON on a replaced array prototype (8b9071b24ead)", () => {
    // FastStringifier only checked the global Array.prototype for toJSON.
    // Object.setPrototypeOf keeps the array on the fast path, so a toJSON on
    // the replaced prototype was ignored.
    const proto = { __proto__: Array.prototype, toJSON: () => "via prototype" };
    const array = Object.setPrototypeOf([1, 2, 3], proto);
    const nonEnumerableProto = Object.create(Array.prototype);
    Object.defineProperty(nonEnumerableProto, "toJSON", {
      value(this: unknown[]) {
        return this.length;
      },
      enumerable: false,
    });
    const ownWins = Object.setPrototypeOf([1], proto);
    Object.defineProperty(ownWins, "toJSON", { value: () => "own", enumerable: false });
    const extra: number[] & { extra?: number } = [1];
    extra.extra = 2;

    expect({
      replaced: JSON.stringify(array),
      replacedNested: JSON.stringify({ array }),
      replacedInArray: JSON.stringify([array]),
      replacedWithGap: JSON.stringify(array, null, 2),
      nonEnumerableOnProto: JSON.stringify(Object.setPrototypeOf([1, 2], nonEnumerableProto)),
      ownWins: JSON.stringify(ownWins),
      untouched: JSON.stringify([1, 2, 3]),
      resetToOriginal: JSON.stringify(Object.setPrototypeOf([1, 2, 3], Array.prototype)),
      nullPrototype: JSON.stringify(Object.setPrototypeOf([1, 2], null)),
      namedProperty: JSON.stringify(extra),
    }).toEqual({
      replaced: '"via prototype"',
      replacedNested: '{"array":"via prototype"}',
      replacedInArray: '["via prototype"]',
      replacedWithGap: '"via prototype"',
      nonEnumerableOnProto: "2",
      ownWins: '"own"',
      untouched: "[1,2,3]",
      resetToOriginal: "[1,2,3]",
      nullPrototype: "[1,2]",
      namedProperty: "[1]",
    });
  });

  test("JSON.stringify reaches toJSON held in a non-reified static table (8b9071b24ead)", () => {
    // Date.prototype.toJSON sits in a static hash table until first touched, and
    // is non-enumerable once reified. Either way the fast path used to return
    // "{}" for it instead of calling it (which throws, since it is not a Date).
    expect(() => JSON.stringify(Date.prototype)).toThrow(TypeError);
  });

  test("WebAssembly.Exception gains options.traceStack and stack getter (bf6512f84f7d)", () => {
    expect(WebAssembly.Exception.length).toBe(2);
    const desc = Object.getOwnPropertyDescriptor(WebAssembly.Exception.prototype, "stack");
    expect(typeof desc?.get).toBe("function");
  });

  test("indirect, namespace and star re-exports link on the JSC ModuleAnalyzer path (90b2ecf79ae3)", async () => {
    // Upstream now threads ScriptFetchParameters::Type through createIndirect /
    // createNamespace / addStarExportEntry and starExportEntries(). This runs
    // under plain `bun run` so JSC's own ModuleAnalyzer builds the record; the
    // BunTranspiledModule path is covered by the --isolate test below.
    using dir = tempDir("wk-reexport", {
      "leaf.mjs": `export const a = 1; export const b = 2; export const c = 3;`,
      "mid.mjs": `
        export { a } from "./leaf.mjs";
        export * as ns from "./leaf.mjs";
        export * from "./leaf.mjs";
      `,
      "entry.mjs": `
        import { a, b, c, ns } from "./mid.mjs";
        process.stdout.write(JSON.stringify({ a, b, c, ns: { a: ns.a, b: ns.b, c: ns.c } }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ a: 1, b: 2, c: 3, ns: { a: 1, b: 2, c: 3 } });
    expect(exitCode).toBe(0);
  });

  test("typed import attributes resolve through BunTranspiledModule (--isolate) (90b2ecf79ae3)", async () => {
    // Upstream 90b2ecf79ae3 keys m_loadedModules on (specifier, type) and
    // ModuleAnalyzer::appendRequestedModule dedupes on that pair. Bun only
    // takes the BunTranspiledModule path under `bun test --isolate`, so
    // exercise it explicitly: without the ImportEntry/RequestedModules type
    // threading this rejects with "Imports different between
    // parseFromSourceCode and fallbackParse" in debug and null-derefs
    // in release.
    using dir = tempDir("wk-typed-import", {
      "d.json": `{"ok":true}`,
      "mid.ts": `
        import j from "./d.json" with { type: "json" };
        import * as ns from "./d.json" with { type: "json" };
        export { j, ns };
      `,
      "typed.test.ts": `
        import j from "./d.json" with { type: "json" };
        import t from "./d.json" with { type: "text" };
        import * as ns from "./d.json" with { type: "json" };
        import { j as rj, ns as rns } from "./mid.ts";
        import { test, expect } from "bun:test";
        test("typed", () => {
          expect(j).toEqual({ ok: true });
          expect(JSON.parse(t as string)).toEqual({ ok: true });
          expect(ns.default).toEqual({ ok: true });
          expect(rj).toEqual({ ok: true });
          expect(rns.default).toEqual({ ok: true });
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "typed.test.ts"],
      env: { ...bunEnv, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("Imports different");
    expect(exitCode).toBe(0);
  });
});
