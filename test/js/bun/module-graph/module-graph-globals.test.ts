import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join, sep } from "node:path";

const { ModuleGraph } = Bun.unsafe as any;

describe("Bun.unsafe.ModuleGraph `globals`", () => {
  describe("reads and writes", () => {
    test("reads and `typeof`", async () => {
      using dir = tempDir("module-graph-globals-reads", {
        "reads.mjs": `
          export const values = () => [count, label, typeof count, typeof label, typeof missing];
          export const readMissing = () => missing;
          export const atTopLevel = [count, label, typeof missing];
          export default label;
        `,
      });
      using graph = new ModuleGraph({ globals: { count: 1, label: "a" } });
      const mod = await graph.import(join(String(dir), "reads.mjs"));

      expect(mod.values()).toEqual([1, "a", "number", "string", "undefined"]);
      expect(mod.atTopLevel).toEqual([1, "a", "undefined"]);
      expect(mod.default).toBe("a");
      expect(mod.readMissing).toThrow(ReferenceError);
    });

    test("assignment in strict module code writes the graph's variable", async () => {
      using dir = tempDir("module-graph-globals-assign", {
        "assign.mjs": `
          export const write = value => (tenant = value);
          export const read = () => tenant;
          export const writeMissing = () => { missing = 1; };
        `,
      });
      const file = join(String(dir), "assign.mjs");
      using a = new ModuleGraph({ globals: { tenant: "a" } });
      using b = new ModuleGraph({ globals: { tenant: "b" } });
      const inA = await a.import(file);
      const inB = await b.import(file);

      const object = {};
      expect(inA.write(object)).toBe(object);
      expect(inA.read()).toBe(object);
      expect(inB.read()).toBe("b");
      inB.write(undefined);
      expect([inA.read(), inB.read()]).toEqual([object, undefined]);

      // A name the graph does not have is still an ordinary strict-mode unresolvable reference.
      expect(inA.writeMissing).toThrow(ReferenceError);
      expect("missing" in globalThis).toBe(false);
    });

    test("compound assignment, `++` and `--`", async () => {
      using dir = tempDir("module-graph-globals-compound", {
        "compound.mjs": `
          export const run = () => {
            const log = [n++, ++n, n--, --n, (n += 5), (n -= 1), (n *= 2), (n /= 4), (n **= 2), (n %= 5), (n <<= 2), (n |= 1), (n &= 3), (n ^= 7)];
            log.push((s += "b"), (nothing ??= "filled"), (nothing ??= "again"), (zero ||= "or"), (one &&= "and"), big++, ++big);
            return { log, n, s, nothing, zero, one, big };
          };
        `,
      });
      const file = join(String(dir), "compound.mjs");
      const globals = { n: 1, s: "a", nothing: null, zero: 0, one: 1, big: 1n };
      using a = new ModuleGraph({ globals });
      using b = new ModuleGraph({ globals });
      const expected = {
        log: [1, 3, 3, 1, 6, 5, 10, 2.5, 6.25, 1.25, 4, 5, 1, 6, "ab", "filled", "filled", "or", "and", 1n, 3n],
        n: 6,
        s: "ab",
        nothing: "filled",
        zero: "or",
        one: "and",
        big: 3n,
      };

      expect((await a.import(file)).run()).toEqual(expected);
      expect((await b.import(file)).run()).toEqual(expected);
      expect(globals).toEqual({ n: 1, s: "a", nothing: null, zero: 0, one: 1, big: 1n });
    });

    test("`delete name` is the strict-mode SyntaxError it always is", async () => {
      using dir = tempDir("module-graph-globals-delete", {
        "delete-static.mjs": `export const run = () => delete tenant;`,
        "delete-eval.mjs": `
          export function run() { return eval("delete tenant"); }
          export const deleteFromGlobalThis = () => delete globalThis.tenant;
          export const read = () => tenant;
        `,
      });
      using graph = new ModuleGraph({ globals: { tenant: "a" } });

      expect(graph.import(join(String(dir), "delete-static.mjs"))).rejects.toBeInstanceOf(SyntaxError);
      const mod = await graph.import(join(String(dir), "delete-eval.mjs"));
      expect(mod.run).toThrow(SyntaxError);
      expect(mod.deleteFromGlobalThis()).toBe(true);
      expect(mod.read()).toBe("a");
    });

    test("destructuring assignment targets and `for` heads", async () => {
      using dir = tempDir("module-graph-globals-destructure", {
        "destructure.mjs": `
          export const run = () => {
            [first, second = "default"] = ["one"];
            ({ third, inner: { fourth }, ...rest } = { third: 3, inner: { fourth: 4 }, extra: 5, more: 6 });
            [, ...tail] = [0, 1, 2];
            const seen = [];
            for (item of ["x", "y"]) seen.push(item);
            for (key in { k1: 1, k2: 2 }) seen.push(key);
            [first, second] = [second, first];
            return { first, second, third, fourth, rest, tail, item, key, seen };
          };
        `,
      });
      const file = join(String(dir), "destructure.mjs");
      const names = ["first", "second", "third", "fourth", "rest", "tail", "item", "key"];
      const globals = Object.fromEntries(names.map(name => [name, "initial " + name]));
      using a = new ModuleGraph({ globals });
      using b = new ModuleGraph({ globals });
      const inA = await a.import(file);
      await b.import(file);

      expect(inA.run()).toEqual({
        first: "default",
        second: "one",
        third: 3,
        fourth: 4,
        rest: { extra: 5, more: 6 },
        tail: [1, 2],
        item: "y",
        key: "k2",
        seen: ["x", "y", "k1", "k2"],
      });
      expect(globals).toEqual(Object.fromEntries(names.map(name => [name, "initial " + name])));
    });

    test("a graph global used as a call target gets no `this`", async () => {
      using dir = tempDir("module-graph-globals-call", {
        "call.mjs": `
          export const run = () => ({
            strict: strictThis(),
            sloppyIsGlobalThis: sloppyThis() === globalThis,
            viaCall: strictThis.call(7),
            optionalCall: [maybe?.(), strictThis?.()],
            tagged: tag\`a\${1}b\`,
            constructed: new Klass(5).value,
            isInstance: new Klass(1) instanceof Klass,
            subclass: new (class extends Klass {})(6).value,
          });
        `,
      });
      function strictThis(this: unknown) {
        return this;
      }
      class Klass {
        constructor(public value: number) {}
      }
      using graph = new ModuleGraph({
        globals: {
          strictThis,
          sloppyThis: new Function("return this"),
          maybe: undefined,
          tag(this: unknown, strings: string[], ...values: unknown[]) {
            return [this, strings.raw, values];
          },
          Klass,
        },
      });
      const mod = await graph.import(join(String(dir), "call.mjs"));

      expect(mod.run()).toEqual({
        strict: undefined,
        sloppyIsGlobalThis: true,
        viaCall: 7,
        optionalCall: [undefined, undefined],
        tagged: [undefined, ["a", "b"], [1]],
        constructed: 5,
        isInstance: true,
        subclass: 6,
      });
    });

    test("closures capture the graph's variable, not its value", async () => {
      using dir = tempDir("module-graph-globals-closures", {
        "closures.mjs": `
          export const makeCounter = () => () => ++count;
          export const makeReader = () => { const reader = () => count; return reader; };
          export const reset = () => { count = 0; };
        `,
      });
      const file = join(String(dir), "closures.mjs");
      using a = new ModuleGraph({ globals: { count: 10 } });
      using b = new ModuleGraph({ globals: { count: 20 } });
      const inA = await a.import(file);
      const inB = await b.import(file);
      const [counterA1, counterA2, readerA, counterB] = [
        inA.makeCounter(),
        inA.makeCounter(),
        inA.makeReader(),
        inB.makeCounter(),
      ];

      expect([counterA1(), counterA2(), counterA1(), readerA(), counterB()]).toEqual([11, 12, 13, 13, 21]);
      inA.reset();
      expect([readerA(), counterA2(), counterB()]).toEqual([0, 1, 22]);
    });

    test("every kind of function body sees them", async () => {
      using dir = tempDir("module-graph-globals-function-kinds", {
        "kinds.mjs": `
          export function declaration() { return tenant; }
          export const arrow = () => tenant;
          export const nested = () => (() => (function () { return (() => tenant)(); })())();
          export class Klass {
            field = tenant;
            #hidden = tenant;
            static staticField = tenant;
            static { this.fromStaticBlock = tenant; }
            method() { return tenant; }
            get getter() { return tenant; }
            get hidden() { return this.#hidden; }
            static staticMethod() { return tenant; }
            [tenant]() { return "computed key"; }
          }
          export const object = { method() { return tenant; }, get getter() { return tenant; } };
          export function* generator() { yield tenant; tenant = "set by the generator"; yield tenant; }
          export async function asyncFunction() { await null; return tenant; }
          export async function* asyncGenerator() { yield tenant; await null; yield tenant; }
          export const asyncArrow = async () => { await null; return tenant; };
        `,
      });
      using graph = new ModuleGraph({ globals: { tenant: "a" } });
      const mod = await graph.import(join(String(dir), "kinds.mjs"));
      const instance = new mod.Klass();

      expect({
        declaration: mod.declaration(),
        arrow: mod.arrow(),
        nested: mod.nested(),
        klass: [
          instance.field,
          instance.hidden,
          mod.Klass.staticField,
          mod.Klass.fromStaticBlock,
          instance.method(),
          instance.getter,
          mod.Klass.staticMethod(),
          instance.a(),
        ],
        object: [mod.object.method(), mod.object.getter],
        asyncFunction: await mod.asyncFunction(),
        asyncArrow: await mod.asyncArrow(),
        asyncGenerator: await Array.fromAsync(mod.asyncGenerator()),
        generator: [...mod.generator()],
        afterGenerator: mod.arrow(),
      }).toEqual({
        declaration: "a",
        arrow: "a",
        nested: "a",
        klass: ["a", "a", "a", "a", "a", "a", "a", "computed key"],
        object: ["a", "a"],
        asyncFunction: "a",
        asyncArrow: "a",
        asyncGenerator: ["a", "a"],
        generator: ["a", "set by the generator"],
        afterGenerator: "set by the generator",
      });
    });

    test("direct eval sees them; indirect eval and `new Function` do not", async () => {
      using dir = tempDir("module-graph-globals-eval", {
        "evals.mjs": `
          export function direct(code) { return eval(code); }
          export const indirect = code => (0, eval)(code);
          export const viaGlobalThis = code => globalThis.eval(code);
          export const viaFunction = code => new Function(code)();
          export const read = () => tenant;
        `,
      });
      using graph = new ModuleGraph({ globals: { tenant: "a" } });
      const mod = await graph.import(join(String(dir), "evals.mjs"));

      expect({
        direct: [mod.direct("tenant"), mod.direct("typeof tenant"), mod.direct("(() => tenant)()")],
        indirect: [mod.indirect("typeof tenant"), mod.viaGlobalThis("typeof tenant")],
        viaFunction: mod.viaFunction("return typeof tenant"),
      }).toEqual({
        direct: ["a", "string", "a"],
        indirect: ["undefined", "undefined"],
        viaFunction: "undefined",
      });
      expect(() => mod.indirect("tenant")).toThrow(ReferenceError);
      expect(() => mod.viaGlobalThis("tenant")).toThrow(ReferenceError);
      expect(() => mod.viaFunction("return tenant")).toThrow(ReferenceError);
      expect(() => mod.viaFunction("tenant = 1")).not.toThrow();
      try {
        // Sloppy-mode `new Function` code created a property of globalThis; the graph's variable is untouched.
        expect([(globalThis as any).tenant, mod.read()]).toEqual([1, "a"]);
      } finally {
        delete (globalThis as any).tenant;
      }

      // A `var` of a strict direct eval is local to that eval.
      expect(mod.direct("var tenant = 'local to the eval'; tenant")).toBe("local to the eval");
      expect(mod.read()).toBe("a");

      // Code created by a direct eval keeps resolving to the graph's variable.
      const reader = mod.direct("() => tenant");
      expect(mod.direct("tenant = 'written by eval'")).toBe("written by eval");
      expect([reader(), mod.read()]).toEqual(["written by eval", "written by eval"]);
    });

    test("template literals, default parameters, shorthand, spread and optional chaining", async () => {
      using dir = tempDir("module-graph-globals-expressions", {
        "expressions.mjs": `
          export const template = () => \`\${greeting}, \${who}!\`;
          export const defaults = (value = who, other = value + "!") => [value, other];
          export const destructuredDefault = ({ name = who } = {}) => name;
          export const shorthand = () => ({ who, [who]: greeting });
          export const spread = () => [...list, ...list];
          export const spreadCall = () => Math.max(...list);
          export const optional = () => [config?.nested?.value, config.missing?.value, nothing?.anything];
          export const comparisons = () => [who === "world", list instanceof Array, "nested" in config];
        `,
      });
      using graph = new ModuleGraph({
        globals: { greeting: "hello", who: "world", list: [1, 2], config: { nested: { value: 1 } }, nothing: null },
      });
      const mod = await graph.import(join(String(dir), "expressions.mjs"));

      expect({
        template: mod.template(),
        defaults: [mod.defaults(), mod.defaults("given")],
        destructuredDefault: [mod.destructuredDefault(), mod.destructuredDefault({ name: "given" })],
        shorthand: mod.shorthand(),
        spread: mod.spread(),
        spreadCall: mod.spreadCall(),
        optional: mod.optional(),
        comparisons: mod.comparisons(),
      }).toEqual({
        template: "hello, world!",
        defaults: [
          ["world", "world!"],
          ["given", "given!"],
        ],
        destructuredDefault: ["world", "given"],
        shorthand: { who: "world", world: "hello" },
        spread: [1, 2, 1, 2],
        spreadCall: 2,
        optional: [1, undefined, undefined],
        comparisons: [true, true, true],
      });
    });

    test("`for` loops", async () => {
      using dir = tempDir("module-graph-globals-loops", {
        "loops.mjs": `
          export const run = () => {
            const out = [];
            for (index = 0; index < limit; index++) out.push(index);
            for (const value of list) out.push(value);
            const closures = [];
            for (let i = 0; i < limit; i++) closures.push(() => i * limit);
            out.push(...closures.map(closure => closure()));
            let steps = 0;
            while (index > 0) { index--; steps++; }
            return { out, steps, index };
          };
        `,
      });
      using graph = new ModuleGraph({ globals: { index: "unset", limit: 3, list: ["a", "b"] } });
      const mod = await graph.import(join(String(dir), "loops.mjs"));

      expect(mod.run()).toEqual({ out: [0, 1, 2, "a", "b", 0, 3, 6], steps: 3, index: 0 });
    });

    test("a hot function shared by two graphs reads and writes its own graph's variables", async () => {
      using dir = tempDir("module-graph-globals-hot", {
        "hot.mjs": `
          export function hot(n) {
            let sum = 0;
            for (let i = 0; i < n; i++) { sum += step; counter++; }
            return [sum, counter];
          }
          export const setStep = value => { step = value; };
        `,
      });
      const file = join(String(dir), "hot.mjs");
      using a = new ModuleGraph({ globals: { step: 1, counter: 0 } });
      using b = new ModuleGraph({ globals: { counter: 100, step: "s" } });
      const inA = await a.import(file);
      const inB = await b.import(file);

      expect(inA.hot(200_000)).toEqual([200_000, 200_000]);
      expect(inB.hot(3)).toEqual(["0sss", 103]);
      expect(inA.hot(1)).toEqual([1, 200_001]);
      inA.setStep(2.5);
      expect(inA.hot(2)).toEqual([5, 200_003]);
      expect(inB.hot(1)).toEqual(["0s", 104]);
    });

    test("they keep working after dispose()", async () => {
      using dir = tempDir("module-graph-globals-disposed", {
        "disposed.mjs": `
          export const read = () => tenant;
          export const write = value => { tenant = value; };
        `,
      });
      const graph = new ModuleGraph({ globals: { tenant: "a" } });
      const mod = await graph.import(join(String(dir), "disposed.mjs"));
      graph.dispose();

      expect(mod.read()).toBe("a");
      mod.write("after dispose");
      expect(mod.read()).toBe("after dispose");
    });
  });

  describe("every module of the graph sees them", () => {
    test("static, dynamic, required, TypeScript and later-loaded modules share one variable", async () => {
      using dir = tempDir("module-graph-globals-dependencies", {
        "entry.mjs": `
          import * as staticDep from "./static-dep.mjs";
          import * as typed from "./typed-dep.ts";
          export { staticDep, typed };
          export const required = import.meta.require("./required-dep.mjs");
          export const loadLazy = () => import("./lazy-dep.mjs");
          export const read = () => tenant;
        `,
        "static-dep.mjs": `export const read = () => tenant; export const atEvaluation = tenant;`,
        "typed-dep.ts": `
          declare let tenant: string;
          export const read = (): string => tenant;
          export const write = (value: string): void => { tenant = value; };
        `,
        "required-dep.mjs": `export const read = () => tenant; export const atEvaluation = tenant;`,
        "lazy-dep.mjs": `export const read = () => tenant; export const atEvaluation = tenant;`,
        "later.mjs": `export const read = () => tenant; export const atEvaluation = tenant;`,
      });
      using graph = new ModuleGraph({ globals: { tenant: "a" } });
      const entry = await graph.import(join(String(dir), "entry.mjs"));
      entry.typed.write("b");
      const lazy = await entry.loadLazy();
      entry.typed.write("c");
      const later = await graph.import(join(String(dir), "later.mjs"));
      entry.typed.write("d");

      expect({
        atEvaluation: [
          entry.staticDep.atEvaluation,
          entry.required.atEvaluation,
          lazy.atEvaluation,
          later.atEvaluation,
        ],
        now: [entry, entry.staticDep, entry.typed, entry.required, lazy, later].map(mod => mod.read()),
      }).toEqual({
        atEvaluation: ["a", "a", "b", "c"],
        now: ["d", "d", "d", "d", "d", "d"],
      });
    });

    test("top-level code reads them in evaluation order", async () => {
      using dir = tempDir("module-graph-globals-evaluation-order", {
        "order-entry.mjs": `
          import "./order-first.mjs";
          import "./order-second.mjs";
          log.push("entry sees " + stage);
          stage = "entry ran";
          const lazy = await import("./order-lazy.mjs");
          log.push("entry after await sees " + stage);
          export default lazy.default;
        `,
        "order-first.mjs": `log.push("first sees " + stage); stage = "first ran";`,
        "order-second.mjs": `log.push("second sees " + stage); stage = "second ran";`,
        "order-lazy.mjs": `log.push("lazy sees " + stage); stage = "lazy ran"; export default stage;`,
      });
      const log: string[] = [];
      using graph = new ModuleGraph({ globals: { log, stage: "nothing ran" } });
      const entry = await graph.import(join(String(dir), "order-entry.mjs"));

      expect(log).toEqual([
        "first sees nothing ran",
        "second sees first ran",
        "entry sees second ran",
        "lazy sees entry ran",
        "entry after await sees lazy ran",
      ]);
      expect(entry.default).toBe("lazy ran");
    });

    test("`data:` and `blob:` modules", async () => {
      using graph = new ModuleGraph({ globals: { tenant: "a" } });
      const url = URL.createObjectURL(
        new Blob(["export default [tenant, typeof tenant];"], { type: "text/javascript" }),
      );
      try {
        expect((await graph.import(url)).default).toEqual(["a", "string"]);
      } finally {
        URL.revokeObjectURL(url);
      }
      expect((await graph.import("data:text/javascript,export default [tenant, typeof tenant];")).default).toEqual([
        "a",
        "string",
      ]);
    });

    test("TypeScript decorators", async () => {
      using dir = tempDir("module-graph-globals-decorators", {
        "decorated.ts": `
          declare const decorate: any;
          @decorate
          export class Decorated {
            @decorate method() {}
          }
        `,
      });
      const decorated: string[] = [];
      using graph = new ModuleGraph({
        globals: { decorate: (target: any, key?: string) => void decorated.push(key ?? target.name) },
      });
      await graph.import(join(String(dir), "decorated.ts"));

      expect(decorated).toEqual(["method", "Decorated"]);
    });

    test("a hoisted function called across an import cycle reads them before its module evaluates", async () => {
      using dir = tempDir("module-graph-globals-cycle", {
        "cycle-a.mjs": `
          import { fromB } from "./cycle-b.mjs";
          export function hoisted() { return tenant; }
          export function hoistedWrite(value) { tenant = value; }
          export function readOwn() { return own; }
          export let own = "a's own binding";
          export const afterB = tenant;
          export { fromB };
        `,
        "cycle-b.mjs": `
          import { hoisted, hoistedWrite, readOwn } from "./cycle-a.mjs";
          const before = hoisted();
          hoistedWrite("written by b through a");
          let ownBinding;
          try { ownBinding = readOwn(); } catch (error) { ownBinding = error.name; }
          export const fromB = { before, after: hoisted(), ownBinding };
        `,
      });
      using graph = new ModuleGraph({ globals: { tenant: "a" } });
      const mod = await graph.import(join(String(dir), "cycle-a.mjs"));

      expect(mod.fromB).toEqual({ before: "a", after: "written by b through a", ownBinding: "ReferenceError" });
      expect(mod.afterB).toBe("written by b through a");
    });

    test("a module using top-level await reads and writes them on both sides of the await", async () => {
      using dir = tempDir("module-graph-globals-tla", {
        "tla-globals.mjs": `
          export const before = tenant;
          tenant = "set before the await";
          await Promise.resolve();
          export const after = tenant;
          tenant = "set after the await";
          export const read = () => tenant;
        `,
      });
      const file = join(String(dir), "tla-globals.mjs");
      using a = new ModuleGraph({ globals: { tenant: "a" } });
      using b = new ModuleGraph({ globals: { tenant: "b" } });
      const [inA, inB] = await Promise.all([a.import(file), b.import(file)]);

      expect([inA.before, inA.after, inA.read()]).toEqual(["a", "set before the await", "set after the await"]);
      expect([inB.before, inB.after, inB.read()]).toEqual(["b", "set before the await", "set after the await"]);
    });
  });

  describe("values", () => {
    test("every kind of value arrives with its identity", async () => {
      class HostClass {}
      const values: Record<string, unknown> = {
        vNumber: 1.5,
        vNegativeZero: -0,
        vNaN: NaN,
        vString: "s",
        vEmptyString: "",
        vTrue: true,
        vFalse: false,
        vUndefined: undefined,
        vNull: null,
        vSymbol: Symbol("local"),
        vRegisteredSymbol: Symbol.for("module-graph-globals"),
        vWellKnownSymbol: Symbol.iterator,
        vBigInt: 2n ** 80n,
        vObject: { nested: {} },
        vNullPrototype: Object.create(null),
        vFrozen: Object.freeze({}),
        vArray: [1, 2, 3],
        vFunction() {},
        vArrow: () => {},
        vAsyncFunction: async () => {},
        vGeneratorFunction: function* () {},
        vBound: function () {}.bind(null),
        vClass: HostClass,
        vInstance: new HostClass(),
        vMap: new Map(),
        vWeakRef: new WeakRef({}),
        vPromise: Promise.resolve(1),
        vDate: new Date(0),
        vRegExp: /x/g,
        vError: new Error("e"),
        vTypedArray: new Uint8Array(4),
        vArrayBuffer: new ArrayBuffer(4),
        vBuffer: Buffer.from("b"),
        vResponseConstructor: Response,
        vRequest: new Request("http://localhost/"),
        vBlob: new Blob(["b"]),
        vURL: new URL("http://localhost/"),
        vHeaders: new Headers(),
        vAbortController: new AbortController(),
        vTextEncoder: new TextEncoder(),
        vBunFile: Bun.file("/does/not/exist"),
        vGlobalThis: globalThis,
        vBun: Bun,
        vProcess: process,
        vModuleGraphConstructor: ModuleGraph,
      };
      const names = Object.keys(values);
      using dir = tempDir("module-graph-globals-values", {
        "values.mjs": `
          export const read = () => ({ ${names.join(", ")} });
          export const types = () => ({ ${names.map(name => `${name}: typeof ${name}`).join(", ")} });
        `,
      });
      using graph = new ModuleGraph({ globals: values });
      const mod = await graph.import(join(String(dir), "values.mjs"));
      const read = mod.read();

      expect(Object.fromEntries(names.map(name => [name, Object.is(read[name], values[name])]))).toEqual(
        Object.fromEntries(names.map(name => [name, true])),
      );
      expect(mod.types()).toEqual(Object.fromEntries(names.map(name => [name, typeof values[name]])));
    });

    test("a name whose value is `undefined` is declared", async () => {
      using dir = tempDir("module-graph-globals-undefined-value", {
        "undefined-value.mjs": `
          export const read = () => [declared, typeof declared];
          export const write = () => { declared = "now defined"; return declared; };
        `,
      });
      const file = join(String(dir), "undefined-value.mjs");
      using graph = new ModuleGraph({ globals: { declared: undefined } });
      using other = new ModuleGraph({ globals: { somethingElse: 1 } });
      const mod = await graph.import(file);
      const inOther = await other.import(file);

      expect(mod.read()).toEqual([undefined, "undefined"]);
      expect(mod.write()).toBe("now defined");
      expect(inOther.read).toThrow(ReferenceError);
      expect(inOther.write).toThrow(ReferenceError);
    });

    test("a Proxy is passed through untouched", async () => {
      using dir = tempDir("module-graph-globals-proxy-value", {
        "proxy-value.mjs": `
          export const identity = () => proxied;
          export const touch = () => [proxied.answer, "answer" in proxied, typeof proxied];
        `,
      });
      const log: string[] = [];
      const proxied = new Proxy(
        { answer: 42 },
        {
          get: (target, key, receiver) => (log.push(`get ${String(key)}`), Reflect.get(target, key, receiver)),
          has: (target, key) => (log.push(`has ${String(key)}`), Reflect.has(target, key)),
          ownKeys: target => (log.push("ownKeys"), Reflect.ownKeys(target)),
          getOwnPropertyDescriptor: (target, key) => (
            log.push(`getOwnPropertyDescriptor ${String(key)}`),
            Reflect.getOwnPropertyDescriptor(target, key)
          ),
        },
      );
      using graph = new ModuleGraph({ globals: { proxied } });
      const mod = await graph.import(join(String(dir), "proxy-value.mjs"));

      expect(mod.identity()).toBe(proxied);
      expect(log).toEqual([]);
      expect(mod.touch()).toEqual([42, true, "object"]);
      expect(log).toEqual(["get answer", "has answer"]);
    });

    test("another ModuleGraph", async () => {
      using dir = tempDir("module-graph-globals-graph-value", {
        "outer.mjs": `
          // Not a tail call: a relative specifier resolves against the calling module's frame.
          export const loadInner = async () => await inner.import("./leaf.mjs");
          export const loadOwn = () => import("./leaf.mjs");
          export const innerGraph = () => inner;
        `,
        "leaf.mjs": `export const types = () => [typeof tenant, typeof inner, typeof innerOnly];`,
      });
      using inner = new ModuleGraph({ globals: { innerOnly: 1 } });
      using outer = new ModuleGraph({ globals: { tenant: "outer", inner } });
      const mod = await outer.import(join(String(dir), "outer.mjs"));
      const leafInInner = await mod.loadInner();
      const leafInOuter = await mod.loadOwn();

      expect(mod.innerGraph()).toBe(inner);
      expect(leafInInner).not.toBe(leafInOuter);
      expect(await inner.import(join(String(dir), "leaf.mjs"))).toBe(leafInInner);
      expect(leafInInner.types()).toEqual(["undefined", "undefined", "number"]);
      expect(leafInOuter.types()).toEqual(["string", "object", "undefined"]);
    });

    test("a graph can be given itself through a mutable value", async () => {
      using dir = tempDir("module-graph-globals-self", {
        "self.mjs": `export const loadAgain = () => self.graph.import(import.meta.path);`,
      });
      const self: { graph?: unknown } = {};
      using graph = new ModuleGraph({ globals: { self } });
      self.graph = graph;
      const mod = await graph.import(join(String(dir), "self.mjs"));

      expect(await mod.loadAgain()).toBe(mod);
    });

    test("a module namespace object", async () => {
      using dir = tempDir("module-graph-globals-namespace-value", {
        "ns-counter.mjs": `
          export let count = 0;
          export const increment = () => ++count;
        `,
        "ns-user.mjs": `
          import * as own from "./ns-counter.mjs";
          export const incrementHosts = () => hostCounter.increment();
          export const counts = () => [hostCounter.count, own.count];
          export const isHosts = namespace => namespace === hostCounter;
          export { own };
        `,
      });
      const hostCounter = await import(join(String(dir), "ns-counter.mjs"));
      using graph = new ModuleGraph({ globals: { hostCounter } });
      const mod = await graph.import(join(String(dir), "ns-user.mjs"));

      expect(mod.isHosts(hostCounter)).toBe(true);
      expect(mod.own).not.toBe(hostCounter);
      mod.incrementHosts();
      mod.incrementHosts();
      expect(mod.counts()).toEqual([2, 0]);
      expect(hostCounter.count).toBe(2);
    });

    test("one object given to two graphs is one object, but two variables", async () => {
      using dir = tempDir("module-graph-globals-shared-value", {
        "shared-value.mjs": `
          export const mutate = value => { shared.value = value; };
          export const rebind = value => { shared = value; };
          export const read = () => shared;
        `,
      });
      const file = join(String(dir), "shared-value.mjs");
      const shared: { value?: string } = {};
      const globals = { shared };
      using a = new ModuleGraph({ globals });
      using b = new ModuleGraph({ globals });
      const inA = await a.import(file);
      const inB = await b.import(file);

      inA.mutate("from a");
      expect(inB.read()).toBe(shared);
      expect(shared.value).toBe("from a");
      inA.rebind("a's own");
      expect([inA.read(), inB.read(), globals.shared]).toEqual(["a's own", shared, shared]);
    });
  });

  describe("the `globals` object", () => {
    const typesOf = (names: string[]) =>
      `export const types = () => ({ ${names.map(name => `${name}: typeof ${name}`).join(", ")} });`;

    test("only own enumerable string keys become names", async () => {
      using dir = tempDir("module-graph-globals-own-enumerable", {
        "own-enumerable.mjs": typesOf([
          "own",
          "ownAccessor",
          "hidden",
          "hiddenAccessor",
          "inherited",
          "inheritedAccessor",
        ]),
      });
      const symbol = Symbol("symbolKey");
      const log: string[] = [];
      const prototype = {
        inherited: 1,
        get inheritedAccessor() {
          log.push("inheritedAccessor");
          return 1;
        },
      };
      const globals = Object.create(prototype, {
        own: { value: 1, enumerable: true },
        ownAccessor: { get: () => (log.push("ownAccessor"), 1), enumerable: true },
        hidden: { value: 1, enumerable: false },
        hiddenAccessor: { get: () => (log.push("hiddenAccessor"), 1), enumerable: false },
        [symbol]: { get: () => (log.push("symbol"), 1), enumerable: true },
        [Symbol.iterator]: { get: () => (log.push("Symbol.iterator"), 1), enumerable: true },
      });
      using graph = new ModuleGraph({ globals });
      const mod = await graph.import(join(String(dir), "own-enumerable.mjs"));

      expect(mod.types()).toEqual({
        own: "number",
        ownAccessor: "number",
        hidden: "undefined",
        hiddenAccessor: "undefined",
        inherited: "undefined",
        inheritedAccessor: "undefined",
      });
      expect(log).toEqual(["ownAccessor"]);
    });

    test("getters run exactly once, at construction, in property order", async () => {
      using dir = tempDir("module-graph-globals-getters", {
        "getters.mjs": `export const read = () => [z, b, a, m, Z, _, aa]; export const write = () => { z = "written"; };`,
      });
      const log: string[] = [];
      const globals = {};
      for (const name of ["z", "b", "10", "a", "m", "2", "Z", "_", "é", "aa"]) {
        Object.defineProperty(globals, name, {
          enumerable: true,
          get() {
            log.push(name);
            return "value of " + name;
          },
          set() {
            log.push("set " + name);
          },
        });
      }
      using graph = new ModuleGraph({ globals });
      // The order of Object.keys(): integer keys ascending, then strings in insertion order.
      expect(log).toEqual(["2", "10", "z", "b", "a", "m", "Z", "_", "é", "aa"]);

      const mod = await graph.import(join(String(dir), "getters.mjs"));
      mod.write();
      expect(mod.read()).toEqual(
        ["written", "b", "a", "m", "Z", "_", "aa"].map((name, i) => (i ? "value of " + name : name)),
      );
      expect(log).toHaveLength(10);
    });

    test("a getter that throws makes the constructor throw that error", () => {
      const error = new Error("from the getter");
      const log: string[] = [];
      const globals = {
        get a() {
          log.push("a");
          return 1;
        },
        get b(): never {
          log.push("b");
          throw error;
        },
        get c() {
          log.push("c");
          return 3;
        },
      };

      let thrown;
      try {
        new ModuleGraph({ globals });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBe(error);
      expect(log).toEqual(["a", "b"]);
      // Anything can be thrown, not just errors.
      try {
        new ModuleGraph({
          globals: {
            get x() {
              throw 42;
            },
          },
        });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBe(42);
    });

    test("the `globals` option itself is read once", () => {
      let reads = 0;
      new ModuleGraph({
        get globals() {
          reads++;
          return { tenant: "a" };
        },
      });
      expect(reads).toBe(1);

      const error = new Error("from the option getter");
      expect(
        () =>
          new ModuleGraph({
            get globals() {
              throw error;
            },
          }),
      ).toThrow(error);
    });

    test("names are snapshotted before any getter runs", async () => {
      using dir = tempDir("module-graph-globals-mutating-getter", {
        "mutating-getter.mjs": `export const types = () => [typeof first, typeof removed, typeof added]; export const readRemoved = () => removed;`,
      });
      const globals: Record<string, unknown> = {
        get first() {
          delete globals.removed;
          globals.added = 1;
          return 1;
        },
        removed: "still here when the names were read",
      };
      using graph = new ModuleGraph({ globals });
      const mod = await graph.import(join(String(dir), "mutating-getter.mjs"));

      // `removed` was a name when construction began, so it is declared; its value was read after the delete.
      expect(mod.types()).toEqual(["number", "undefined", "undefined"]);
      expect(mod.readRemoved()).toBeUndefined();
    });

    test("is copied: later changes to it do not reach the graph, and the graph never writes to it", async () => {
      using dir = tempDir("module-graph-globals-copied", {
        "copied.mjs": `
          export const read = () => [kept, typeof addedLater, removedLater];
          export const write = () => { kept = "written by the graph"; removedLater = "also written"; };
        `,
      });
      const file = join(String(dir), "copied.mjs");
      const sets: string[] = [];
      let accessorValue = "accessor";
      const globals: Record<string, unknown> = {
        kept: "original",
        get removedLater() {
          return accessorValue;
        },
        set removedLater(value: string) {
          sets.push(value);
        },
      };
      using graph = new ModuleGraph({ globals });

      // Before the first import...
      globals.kept = "changed by the host";
      globals.addedLater = 1;
      accessorValue = "changed accessor";
      const mod = await graph.import(file);
      expect(mod.read()).toEqual(["original", "undefined", "accessor"]);

      // ...and after it.
      delete globals.removedLater;
      Object.freeze(globals);
      mod.write();
      expect(mod.read()).toEqual(["written by the graph", "undefined", "also written"]);
      expect(globals).toEqual({ kept: "changed by the host", addedLater: 1 });
      expect(sets).toEqual([]);
    });

    test("is left as it was", () => {
      const globals = {
        a: 1,
        get b() {
          return 2;
        },
      };
      const before = Object.getOwnPropertyDescriptors(globals);
      new ModuleGraph({ globals });

      expect(Object.getOwnPropertyDescriptors(globals)).toEqual(before);
      expect([Object.isExtensible(globals), Object.isFrozen(globals)]).toEqual([true, false]);
    });

    test("`{}`, `undefined` and no options at all add nothing", async () => {
      using dir = tempDir("module-graph-globals-empty", {
        "empty.mjs": `export const probe = () => [typeof tenant, typeof globals, typeof onError];`,
      });
      const file = join(String(dir), "empty.mjs");
      const graphs = [
        new ModuleGraph(),
        new ModuleGraph(undefined),
        new ModuleGraph({}),
        new ModuleGraph({ globals: undefined }),
        new ModuleGraph({ globals: {} }),
        new ModuleGraph({ globals: Object.create({ tenant: "inherited" }) }),
        new ModuleGraph({ globals: { [Symbol("tenant")]: 1 } }),
      ];

      for (const graph of graphs) {
        expect((await graph.import(file)).probe()).toEqual(["undefined", "undefined", "undefined"]);
        graph.dispose();
      }
    });

    test("may be a Proxy", async () => {
      using dir = tempDir("module-graph-globals-proxy-object", {
        "proxy-object.mjs": `export const read = () => [a, b, typeof hidden, typeof virtual];`,
      });
      const log: string[] = [];
      const target = Object.defineProperty({ a: 1, b: 2, [Symbol("s")]: 3 }, "hidden", { value: 4, enumerable: false });
      const globals = new Proxy(target, {
        ownKeys: t => (log.push("ownKeys"), Reflect.ownKeys(t)),
        getOwnPropertyDescriptor: (t, key) => (
          log.push(`getOwnPropertyDescriptor ${String(key)}`),
          Reflect.getOwnPropertyDescriptor(t, key)
        ),
        get: (t, key, receiver) => (
          log.push(`get ${String(key)}`),
          key === "a" ? "from the trap" : Reflect.get(t, key, receiver)
        ),
        has: (t, key) => (log.push(`has ${String(key)}`), Reflect.has(t, key)),
        set: (t, key) => (log.push(`set ${String(key)}`), true),
      });
      using graph = new ModuleGraph({ globals });
      const afterConstruction = [...log];
      const mod = await graph.import(join(String(dir), "proxy-object.mjs"));

      expect(mod.read()).toEqual(["from the trap", 2, "undefined", "undefined"]);
      expect(afterConstruction).toEqual([
        "ownKeys",
        "getOwnPropertyDescriptor a",
        "getOwnPropertyDescriptor b",
        "getOwnPropertyDescriptor hidden",
        "get a",
        "get b",
      ]);
      expect(log).toEqual(afterConstruction);
    });

    test("a Proxy whose trap throws makes the constructor throw that error", () => {
      const error = new Error("from the trap");
      for (const trap of ["ownKeys", "getOwnPropertyDescriptor", "get"]) {
        const globals = new Proxy(
          { a: 1 },
          {
            [trap]() {
              throw error;
            },
          },
        );
        expect(() => new ModuleGraph({ globals })).toThrow(error);
      }
      const revocable = Proxy.revocable({ a: 1 }, {});
      revocable.revoke();
      expect(() => new ModuleGraph({ globals: revocable.proxy })).toThrow(TypeError);
    });

    test("may be an array, a function, a class instance, a null-prototype object or a Map", async () => {
      using dir = tempDir("module-graph-globals-object-kinds", {
        "object-kinds.mjs": `
          export const read = () => typeof named === "undefined" ? undefined : named;
          export const types = () => [typeof length, typeof prototype, typeof method, typeof accessor, typeof size];
        `,
      });
      const file = join(String(dir), "object-kinds.mjs");
      class Instance {
        named = "class instance";
        method() {}
        get accessor() {
          return 1;
        }
      }
      const kinds = {
        array: Object.assign(["element"], { named: "array" }),
        function: Object.assign(function () {}, { named: "function" }),
        instance: new Instance(),
        nullPrototype: Object.assign(Object.create(null), { named: "null prototype" }),
        map: Object.assign(new Map([["named", "a Map entry is not a property"]]), { named: "map" }),
        plainArray: ["element"],
      };

      const results: Record<string, unknown> = {};
      for (const [kind, globals] of Object.entries(kinds)) {
        using graph = new ModuleGraph({ globals });
        const mod = await graph.import(file);
        results[kind] = [mod.read(), mod.types()];
      }
      const noTypes = ["undefined", "undefined", "undefined", "undefined", "undefined"];
      expect(results).toEqual({
        array: ["array", noTypes],
        function: ["function", noTypes],
        instance: ["class instance", noTypes],
        nullPrototype: ["null prototype", noTypes],
        map: ["map", noTypes],
        plainArray: [undefined, noTypes],
      });
    });

    test("may be globalThis", async () => {
      using dir = tempDir("module-graph-globals-global-this", {
        "global-this.mjs": `
          export const sameValues = () => fetch === globalThis.fetch && setTimeout === globalThis.setTimeout;
          export const write = () => { fetch = "the graph's"; return [fetch, typeof globalThis.fetch]; };
        `,
      });
      // `fetch` and `setTimeout` are enumerable properties of globalThis, so they become names of the graph.
      const realFetch = fetch;
      using graph = new ModuleGraph({ globals: globalThis });
      const mod = await graph.import(join(String(dir), "global-this.mjs"));

      expect(mod.sameValues()).toBe(true);
      expect(mod.write()).toEqual(["the graph's", "function"]);
      expect(globalThis.fetch).toBe(realFetch);
    });

    test("may be a module namespace object, unless one of its bindings is uninitialized", async () => {
      using dir = tempDir("module-graph-globals-namespace-object", {
        "namespace-globals.mjs": `
          import * as self from "./namespace-globals.mjs";
          export let early;
          try {
            new Bun.unsafe.ModuleGraph({ globals: self });
            early = "constructed";
          } catch (error) {
            early = error.name;
          }
          export const tenant = "from the namespace";
          export const makeGraph = () => new Bun.unsafe.ModuleGraph({ globals: self });
        `,
        "namespace-reader.mjs": `export const read = () => [tenant, early, typeof makeGraph];`,
      });
      const host = await import(join(String(dir), "namespace-globals.mjs"));
      using graph = host.makeGraph();
      const mod = await graph.import(join(String(dir), "namespace-reader.mjs"));

      expect(host.early).toBe("ReferenceError");
      expect(mod.read()).toEqual(["from the namespace", "ReferenceError", "function"]);
    });

    test.each([
      ["a number", 1],
      ["zero", 0],
      ["a string", "tenant"],
      ["an empty string", ""],
      ["null", null],
      ["true", true],
      ["false", false],
      ["a symbol", Symbol("globals")],
      ["a bigint", 1n],
    ])("throws ERR_INVALID_ARG_TYPE when it is %s", (_, globals) => {
      expect(() => new ModuleGraph({ globals })).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", name: "TypeError" }),
      );
    });

    test("works through a subclass of ModuleGraph", async () => {
      using dir = tempDir("module-graph-globals-subclass", {
        "subclass.mjs": `export const read = () => tenant;`,
      });
      class TenantGraph extends ModuleGraph {
        constructor(tenant: string) {
          super({ globals: { tenant } });
        }
      }
      using graph = new TenantGraph("from the subclass") as any;

      expect(graph).toBeInstanceOf(TenantGraph);
      expect((await graph.import(join(String(dir), "subclass.mjs"))).read()).toBe("from the subclass");
    });
  });

  describe("names", () => {
    test("names that are not identifiers are harmless", async () => {
      using dir = tempDir("module-graph-globals-non-identifiers", {
        "non-identifiers.mjs": `
          export const read = () => [valid, also_valid];
          export const onGlobalThis = names => names.filter(name => name in globalThis);
        `,
      });
      const odd = [
        "a b",
        "a-b",
        "",
        "0",
        "1",
        "1.5",
        "-1",
        "with.dot",
        "a;b",
        "a\nb",
        "a\0b",
        "#private",
        "@at",
        "💥",
        " ",
        "var x",
      ];
      const globals: Record<string, unknown> = { valid: "v", also_valid: "av" };
      for (const name of odd) globals[name] = "odd";
      using graph = new ModuleGraph({ globals });
      const mod = await graph.import(join(String(dir), "non-identifiers.mjs"));

      expect(mod.read()).toEqual(["v", "av"]);
      expect(mod.onGlobalThis(odd)).toEqual([]);
    });

    test("unicode identifiers, escapes, `$` and `_`", async () => {
      using dir = tempDir("module-graph-globals-unicode", {
        "unicode.mjs": `
          export const read = () => [ñ, 日本語, 𠮷, ℮, ᚠ, $, _, $$, __, a‍b, π];
          export const escaped = () => [\\u0074enant, \\u{74}enant, tenant, \\u{20BB7}];
          export const write = () => { \\u00F1 = "written through an escape"; return ñ; };
        `,
      });
      const globals = {
        ñ: 1,
        日本語: 2,
        "𠮷": 3,
        "℮": 4,
        ᚠ: 5,
        $: 6,
        _: 7,
        $$: 8,
        __: 9,
        "a‍b": 10,
        π: 11,
        tenant: "t",
      };
      using graph = new ModuleGraph({ globals });
      const mod = await graph.import(join(String(dir), "unicode.mjs"));

      expect(mod.read()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect(mod.escaped()).toEqual(["t", "t", "t", 3]);
      expect(mod.write()).toBe("written through an escape");
    });

    test("names differing only in case or normalization are different names", async () => {
      using dir = tempDir("module-graph-globals-case", {
        "case.mjs": `export const read = () => [tenant, Tenant, TENANT, é, é];`,
      });
      using graph = new ModuleGraph({
        globals: { tenant: 1, Tenant: 2, TENANT: 3, "é": "precomposed", "é": "decomposed" },
      });
      const mod = await graph.import(join(String(dir), "case.mjs"));

      expect(mod.read()).toEqual([1, 2, 3, "precomposed", "decomposed"]);
    });

    test("a very long name", async () => {
      const name = "n" + Buffer.alloc(10_000, "x").toString();
      using dir = tempDir("module-graph-globals-long-name", {
        "long-name.mjs": `export const read = () => ${name}; export const write = value => { ${name} = value; };`,
      });
      using graph = new ModuleGraph({ globals: { [name]: "long" } });
      const mod = await graph.import(join(String(dir), "long-name.mjs"));

      expect(mod.read()).toBe("long");
      mod.write("still long");
      expect(mod.read()).toBe("still long");
    });

    test("names of globalThis properties shadow them for the graph only", async () => {
      const names = [
        "console",
        "process",
        "fetch",
        "Bun",
        "setTimeout",
        "globalThis",
        "Array",
        "Object",
        "Symbol",
        "JSON",
        "Math",
        "Promise",
        "Error",
        "queueMicrotask",
      ];
      using dir = tempDir("module-graph-globals-shadow-global-object", {
        "shadow-global-object.mjs": `
          export const read = () => ({ ${names.join(", ")} });
          export const moduleAndExports = () => [module, exports];
          export const literals = () => [[].constructor === Array, ({}).constructor === Object];
        `,
      });
      const file = join(String(dir), "shadow-global-object.mjs");
      const real = Object.fromEntries(names.map(name => [name, (globalThis as any)[name]]));
      const descriptors = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
      const globals = Object.fromEntries(names.map(name => [name, "the graph's " + name]));
      using graph = new ModuleGraph({
        globals: { ...globals, module: "the graph's module", exports: "the graph's exports" },
      });
      using plain = new ModuleGraph({ globals: { unrelated: 1 } });
      const mod = await graph.import(file);

      expect(mod.read()).toEqual(globals);
      expect(mod.moduleAndExports()).toEqual(["the graph's module", "the graph's exports"]);
      // Literals do not go through the identifier.
      expect(mod.literals()).toEqual([false, false]);

      // globalThis, the host's instance and a graph without those names are untouched.
      expect(names.map(name => Object.getOwnPropertyDescriptor(globalThis, name))).toEqual(descriptors);
      const inHost = (await import(file)).read();
      const inPlain = (await plain.import(file)).read();
      expect(
        names.filter(name => !Object.is(inHost[name], real[name]) || !Object.is(inPlain[name], real[name])),
      ).toEqual([]);
    });

    test("assigning to a shadowing name writes the graph's variable, not the globalThis property", async () => {
      using dir = tempDir("module-graph-globals-shadow-write", {
        "shadow-write.mjs": `
          export const write = () => { console = "replaced"; setTimeout = "replaced too"; return [console, setTimeout]; };
          export const viaGlobalThis = () => [typeof globalThis.console, typeof globalThis.setTimeout];
        `,
      });
      const realConsole = console;
      const realSetTimeout = setTimeout;
      using graph = new ModuleGraph({ globals: { console: "the graph's", setTimeout: "the graph's" } });
      const mod = await graph.import(join(String(dir), "shadow-write.mjs"));

      expect(mod.write()).toEqual(["replaced", "replaced too"]);
      expect(mod.viaGlobalThis()).toEqual(["object", "function"]);
      expect([globalThis.console, globalThis.setTimeout]).toEqual([realConsole, realSetTimeout]);
    });

    // The language's three constant globals. The transpiler folds them and prints them, so a graph cannot rebind them.
    test.each(["undefined", "NaN", "Infinity"])("`%s` cannot be a name", name => {
      const log: string[] = [];
      const globals = {
        get before() {
          log.push("before");
          return 1;
        },
        [name]: "the graph's",
        get after() {
          log.push("after");
          return 2;
        },
      };
      expect(() => new ModuleGraph({ globals })).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE", message: expect.stringContaining(name) }),
      );
      expect(log).toEqual(["before"]);
    });

    test("reserved words and contextual keywords as names", async () => {
      using dir = tempDir("module-graph-globals-reserved", {
        "reserved.mjs": `
          export const literals = function () { return [this, null, true, false, typeof import.meta, typeof new.target, typeof void 0]; };
          export const contextual = () => [async, of, get, set, from, as, target, meta, type, accessor];
          export const valid = () => tenant;
        `,
      });
      const reserved = [
        "await",
        "break",
        "case",
        "catch",
        "class",
        "const",
        "continue",
        "debugger",
        "default",
        "delete",
        "do",
        "else",
        "enum",
        "export",
        "extends",
        "false",
        "finally",
        "for",
        "function",
        "if",
        "implements",
        "import",
        "in",
        "instanceof",
        "interface",
        "let",
        "new",
        "null",
        "package",
        "private",
        "protected",
        "public",
        "return",
        "static",
        "super",
        "switch",
        "this",
        "throw",
        "true",
        "try",
        "typeof",
        "var",
        "void",
        "while",
        "with",
        "yield",
      ];
      const contextual = ["async", "of", "get", "set", "from", "as", "target", "meta", "type", "accessor"];
      const globals: Record<string, unknown> = { tenant: "a" };
      for (const name of [...reserved, ...contextual]) globals[name] = "the graph's " + name;
      using graph = new ModuleGraph({ globals });
      const mod = await graph.import(join(String(dir), "reserved.mjs"));

      expect(mod.literals.call(undefined)).toEqual([undefined, null, true, false, "object", "undefined", "undefined"]);
      expect(mod.contextual()).toEqual(contextual.map(name => "the graph's " + name));
      expect(mod.valid()).toBe("a");
    });

    test("`arguments` and `eval` as names", async () => {
      using dir = tempDir("module-graph-globals-arguments-eval", {
        "arguments-eval.mjs": `
          export const atTopLevel = arguments;
          export const inArrow = () => arguments;
          export function inFunction() { return [typeof arguments, arguments.length, (() => arguments[0])()]; }
          export const evalIdentifier = () => eval;
          export const callsEval = () => eval("1 + 1");
        `,
      });
      const file = join(String(dir), "arguments-eval.mjs");
      const graphEval = (code: string) => "the graph's eval got " + code;
      using graph = new ModuleGraph({ globals: { arguments: "the graph's arguments", eval: graphEval } });
      const mod = await graph.import(file);

      expect({
        atTopLevel: mod.atTopLevel,
        inArrow: mod.inArrow(),
        inFunction: mod.inFunction("first", "second"),
        evalIdentifier: mod.evalIdentifier(),
        callsEval: mod.callsEval(),
      }).toEqual({
        atTopLevel: "the graph's arguments",
        inArrow: "the graph's arguments",
        inFunction: ["object", 2, "first"],
        evalIdentifier: graphEval,
        callsEval: "the graph's eval got 1 + 1",
      });
      expect(globalThis.eval("1 + 1")).toBe(2);
    });

    test("`__proto__` and Object.prototype names", async () => {
      using dir = tempDir("module-graph-globals-proto", {
        "proto.mjs": `
          export const read = () => [__proto__, constructor, typeof hasOwnProperty, toString === Object.prototype.toString, typeof valueOf];
          export const literal = () => Object.getPrototypeOf({ __proto__: null });
        `,
      });
      const globals = JSON.parse(`{ "__proto__": "the graph's __proto__", "constructor": "the graph's constructor" }`);
      using graph = new ModuleGraph({ globals });
      const mod = await graph.import(join(String(dir), "proto.mjs"));

      // The scope holding the names is not an object: it has no prototype chain of its own, so
      // names it lacks still come from globalThis (which inherits from Object.prototype).
      expect(mod.read()).toEqual(["the graph's __proto__", "the graph's constructor", "function", true, "function"]);
      expect(mod.literal()).toBeNull();
    });

    test("`require`, `__dirname` and `__filename` stay the module's own", async () => {
      using dir = tempDir("module-graph-globals-dirname", {
        "dirname.mjs": `export const read = () => [__dirname, __filename, typeof require, require("node:path").sep];`,
      });
      const file = join(String(dir), "dirname.mjs");
      using graph = new ModuleGraph({
        globals: { __dirname: "the graph's", __filename: "the graph's", require: "the graph's" },
      });

      const read = (await graph.import(file)).read();
      expect(read).toEqual((await import(file)).read());
      expect(read.slice(2)).toEqual(["function", sep]);
    });
  });

  describe("shadowing", () => {
    test("a module's own top-level declarations and imports win in that module only", async () => {
      const names = [
        "viaConst",
        "viaLet",
        "viaVar",
        "viaFunction",
        "viaClass",
        "viaImport",
        "viaDefaultImport",
        "viaNamespaceImport",
        "viaRenamedImport",
      ];
      using dir = tempDir("module-graph-globals-shadowing", {
        "shadower.mjs": `
          import { viaImport, original as viaRenamedImport } from "./shadow-exports.mjs";
          import viaDefaultImport from "./shadow-exports.mjs";
          import * as viaNamespaceImport from "./shadow-exports.mjs";
          const viaConst = "module's const";
          let viaLet = "module's let";
          var viaVar = "module's var";
          function viaFunction() {}
          class viaClass {}
          export const read = () => ({ ${names.join(", ")} });
          export const write = () => { viaLet = "module's let, written"; viaVar = "module's var, written"; };
          export { read as readOther, write as writeOther } from "./bystander.mjs";
        `,
        "shadow-exports.mjs": `
          export const viaImport = "imported";
          export const original = "renamed import";
          export default "default import";
        `,
        "bystander.mjs": `
          export const read = () => ({ ${names.join(", ")} });
          export const write = () => { viaLet = "graph's, written by the bystander"; };
        `,
      });
      const globals = Object.fromEntries(names.map(name => [name, "graph's " + name]));
      using graph = new ModuleGraph({ globals });
      const mod = await graph.import(join(String(dir), "shadower.mjs"));

      const own = mod.read();
      expect({
        ...own,
        viaFunction: typeof own.viaFunction,
        viaClass: typeof own.viaClass,
        viaNamespaceImport: own.viaNamespaceImport.default,
      }).toEqual({
        viaConst: "module's const",
        viaLet: "module's let",
        viaVar: "module's var",
        viaFunction: "function",
        viaClass: "function",
        viaImport: "imported",
        viaDefaultImport: "default import",
        viaNamespaceImport: "default import",
        viaRenamedImport: "renamed import",
      });
      expect(mod.readOther()).toEqual(globals);

      mod.write();
      mod.writeOther();
      expect([mod.read().viaLet, mod.read().viaVar]).toEqual(["module's let, written", "module's var, written"]);
      expect(mod.readOther()).toEqual({ ...globals, viaLet: "graph's, written by the bystander" });
    });

    test("a module's own binding in its temporal dead zone does not fall through to the graph's", async () => {
      using dir = tempDir("module-graph-globals-tdz", {
        "tdz.mjs": `
          export function read() { return shadowed; }
          let early;
          try { early = read(); } catch (error) { early = error.name; }
          export { early };
          export let shadowed = "module's";
          export const hoistedVar = (() => viaVar)();
          export var viaVar = "module's var";
        `,
      });
      using graph = new ModuleGraph({ globals: { shadowed: "graph's", viaVar: "graph's" } });
      const mod = await graph.import(join(String(dir), "tdz.mjs"));

      expect([mod.early, mod.read(), mod.hoistedVar]).toEqual(["ReferenceError", "module's", undefined]);
    });

    test("parameters, block bindings, catch bindings and function names shadow locally", async () => {
      using dir = tempDir("module-graph-globals-local-shadowing", {
        "local-shadowing.mjs": `
          export const parameter = tenant => tenant;
          export const defaulted = (tenant = "default") => tenant;
          export const destructured = ({ tenant }) => tenant;
          export const block = () => { const out = []; { let tenant = "block"; out.push(tenant); } out.push(tenant); return out; };
          export const loop = () => { const out = []; for (const tenant of ["loop"]) out.push(tenant); out.push(tenant); return out; };
          export const caught = () => { try { throw "caught"; } catch (tenant) { return [tenant, (() => tenant)()]; } };
          export const named = function tenant() { return typeof tenant; };
          export const klass = () => { class tenant { static self() { return tenant; } } return tenant.self() === tenant; };
          export const hoistedVar = () => { const before = tenant; var tenant = "function var"; return [before, tenant]; };
          export const writeLocal = tenant => { tenant = "written to the parameter"; return tenant; };
          export const read = () => tenant;
        `,
      });
      using graph = new ModuleGraph({ globals: { tenant: "graph's" } });
      const mod = await graph.import(join(String(dir), "local-shadowing.mjs"));

      expect({
        parameter: mod.parameter("parameter"),
        defaulted: [mod.defaulted(), mod.defaulted("given")],
        destructured: mod.destructured({ tenant: "destructured" }),
        block: mod.block(),
        loop: mod.loop(),
        caught: mod.caught(),
        named: mod.named(),
        klass: mod.klass(),
        hoistedVar: mod.hoistedVar(),
        writeLocal: mod.writeLocal("x"),
        read: mod.read(),
      }).toEqual({
        parameter: "parameter",
        defaulted: ["default", "given"],
        destructured: "destructured",
        block: ["block", "graph's"],
        loop: ["loop", "graph's"],
        caught: ["caught", "caught"],
        named: "function",
        klass: true,
        hoistedVar: [undefined, "function var"],
        writeLocal: "written to the parameter",
        read: "graph's",
      });
    });

    test("a graph global cannot be exported by name, as in the host", async () => {
      using dir = tempDir("module-graph-globals-export-by-name", {
        "export-by-name.mjs": `export { tenant };`,
        "export-default.mjs": `export { tenant as default };`,
      });
      using graph = new ModuleGraph({ globals: { tenant: "a" } });

      const inHost = await import(join(String(dir), "export-by-name.mjs")).catch(error => error);
      const inGraph = await graph.import(join(String(dir), "export-by-name.mjs")).catch((error: unknown) => error);
      expect(inHost).toBeInstanceOf(Error);
      expect(inGraph.message).toBe(inHost.message);
      expect(graph.import(join(String(dir), "export-default.mjs"))).rejects.toThrow();
    });

    test("a module may export a binding with a graph global's name", async () => {
      using dir = tempDir("module-graph-globals-export-same-name", {
        "exporter.mjs": `export let tenant = "exported"; export const setTenant = value => { tenant = value; };`,
        "importer.mjs": `
          import * as exporter from "./exporter.mjs";
          export const read = () => [tenant, exporter.tenant];
          export const setBoth = value => { tenant = value + " (graph's)"; exporter.setTenant(value + " (export)"); };
        `,
      });
      using graph = new ModuleGraph({ globals: { tenant: "graph's" } });
      const mod = await graph.import(join(String(dir), "importer.mjs"));

      expect(mod.read()).toEqual(["graph's", "exported"]);
      mod.setBoth("changed");
      expect(mod.read()).toEqual(["changed (graph's)", "changed (export)"]);
    });
  });

  describe("isolation", () => {
    test("they are not properties of globalThis", async () => {
      using dir = tempDir("module-graph-globals-not-on-global-object", {
        "not-on-global-object.mjs": `
          export const probe = () => ({
            in: "tenant" in globalThis,
            value: globalThis.tenant,
            hasOwn: Object.hasOwn(globalThis, "tenant"),
            reflectHas: Reflect.has(globalThis, "tenant"),
            descriptor: Object.getOwnPropertyDescriptor(globalThis, "tenant"),
            viaSelf: typeof self === "undefined" ? undefined : self.tenant,
          });
          export const write = () => { tenant = "written"; };
        `,
      });
      const keysBefore = Object.keys(globalThis);
      const namesBefore = Object.getOwnPropertyNames(globalThis);
      using graph = new ModuleGraph({ globals: { tenant: "a" } });
      const mod = await graph.import(join(String(dir), "not-on-global-object.mjs"));
      mod.write();

      const absent = {
        in: false,
        value: undefined,
        hasOwn: false,
        reflectHas: false,
        descriptor: undefined,
        viaSelf: undefined,
      };
      expect(mod.probe()).toEqual(absent);
      expect("tenant" in globalThis).toBe(false);
      expect((globalThis as any).tenant).toBeUndefined();
      expect(Object.keys(globalThis)).toEqual(keysBefore);
      expect(Object.getOwnPropertyNames(globalThis)).toEqual(namesBefore);
    });

    test("a globalThis property of the same name is independent of the graph's variable", async () => {
      using dir = tempDir("module-graph-globals-vs-global-property", {
        "vs-global-property.mjs": `
          export const read = () => [moduleGraphGlobalsTestKey, globalThis.moduleGraphGlobalsTestKey];
          export const writeVariable = value => { moduleGraphGlobalsTestKey = value; };
          export const writeProperty = value => { globalThis.moduleGraphGlobalsTestKey = value; };
        `,
      });
      const file = join(String(dir), "vs-global-property.mjs");
      using graph = new ModuleGraph({ globals: { moduleGraphGlobalsTestKey: "graph's" } });
      using plain = new ModuleGraph();
      const mod = await graph.import(file);
      const inPlain = await plain.import(file);
      // The plain graph's reference is unresolvable until the property exists.
      expect(mod.read()).toEqual(["graph's", undefined]);
      expect(inPlain.read).toThrow(ReferenceError);
      try {
        (globalThis as any).moduleGraphGlobalsTestKey = "property";
        expect([mod.read(), inPlain.read()]).toEqual([
          ["graph's", "property"],
          ["property", "property"],
        ]);

        mod.writeVariable("graph's, written");
        mod.writeProperty("property, written by the graph");
        inPlain.writeVariable("property, written by the plain graph");
        expect([mod.read(), inPlain.read()]).toEqual([
          ["graph's, written", "property, written by the plain graph"],
          ["property, written by the plain graph", "property, written by the plain graph"],
        ]);
      } finally {
        delete (globalThis as any).moduleGraphGlobalsTestKey;
      }
      expect(mod.read()).toEqual(["graph's, written", undefined]);
    });

    test("the host's instance of the same file does not see them", async () => {
      using dir = tempDir("module-graph-globals-host-instance", {
        "host-instance.mjs": `
          export const read = () => tenant;
          export const type = () => typeof tenant;
          export const write = () => { tenant = "written"; };
        `,
      });
      const file = join(String(dir), "host-instance.mjs");
      using graph = new ModuleGraph({ globals: { tenant: "a" } });
      const inGraph = await graph.import(file);
      const host = await import(file);

      expect([inGraph.read(), inGraph.type(), host.type()]).toEqual(["a", "string", "undefined"]);
      expect(host.read).toThrow(ReferenceError);
      expect(host.write).toThrow(ReferenceError);
      inGraph.write();
      expect([inGraph.read(), host.type()]).toEqual(["written", "undefined"]);
    });

    test("a module that fails in the host for want of a name loads in a graph that has it", async () => {
      using dir = tempDir("module-graph-globals-top-level-reference", {
        "top-level-reference.mjs": `export const atEvaluation = tenant;`,
      });
      const file = join(String(dir), "top-level-reference.mjs");
      using graph = new ModuleGraph({ globals: { tenant: "a" } });
      using without = new ModuleGraph({ globals: { other: "b" } });

      expect(import(file)).rejects.toBeInstanceOf(ReferenceError);
      expect(without.import(file)).rejects.toBeInstanceOf(ReferenceError);
      expect((await graph.import(file)).atEvaluation).toBe("a");
    });

    test("CommonJS modules reached from the graph do not see them", async () => {
      using dir = tempDir("module-graph-globals-commonjs", {
        "uses-commonjs.mjs": `
          import { createRequire } from "node:module";
          import imported from "./shared-commonjs.cjs";
          export { imported };
          export const viaImportMetaRequire = import.meta.require("./shared-commonjs.cjs");
          export const viaCreateRequire = createRequire(import.meta.url)("./shared-commonjs.cjs");
          export const read = () => tenant;
        `,
        "shared-commonjs.cjs": `
          exports.type = () => typeof tenant;
          exports.read = () => tenant;
          exports.typeAtEvaluation = typeof tenant;
        `,
      });
      using graph = new ModuleGraph({ globals: { tenant: "a" } });
      const mod = await graph.import(join(String(dir), "uses-commonjs.mjs"));

      expect(mod.read()).toBe("a");
      expect(mod.viaImportMetaRequire).toBe(mod.imported);
      expect(mod.viaCreateRequire).toBe(mod.imported);
      expect([mod.imported.type(), mod.imported.typeAtEvaluation]).toEqual(["undefined", "undefined"]);
      expect(mod.imported.read).toThrow(ReferenceError);
    });

    test("scoping is lexical: host functions the graph calls do not see them", async () => {
      using dir = tempDir("module-graph-globals-lexical", {
        "lexical.mjs": `
          export const callHost = () => hostProbe();
          export const callback = fn => fn();
        `,
      });
      using graph = new ModuleGraph({
        globals: { tenant: "a", hostProbe: () => typeof (globalThis as any).tenant + "/" + eval("typeof tenant") },
      });
      const mod = await graph.import(join(String(dir), "lexical.mjs"));

      expect(mod.callHost()).toBe("undefined/undefined");
      expect(mod.callback(() => eval("typeof tenant"))).toBe("undefined");
    });

    test("a global lexical declaration made later by a script sits behind the graph's names", async () => {
      using dir = tempDir("module-graph-globals-global-lexical", {
        "lexical-reader.mjs": `
          export const read = () => { try { return [tenant, lateLexical]; } catch (error) { return error.name; } };
          export const write = value => { tenant = value; };
          export function hot(n) { let sum = 0; for (let i = 0; i < n; i++) sum += typeof lateLexical === "number" ? lateLexical : 0; return sum; }
        `,
        "main.mjs": `
          import vm from "node:vm";
          const { ModuleGraph } = Bun.unsafe;
          const file = import.meta.dir + "/lexical-reader.mjs";
          const withTenant = await new ModuleGraph({ globals: { tenant: "graph's" } }).import(file);
          const plain = await new ModuleGraph().import(file);
          const host = await import(file);
          const instances = [withTenant, plain, host];

          const before = instances.map(instance => [instance.read(), instance.hot(20000)]);
          new vm.Script("let lateLexical = 1; let tenant = 'script';").runInThisContext();
          const after = instances.map(instance => [instance.read(), instance.hot(20000)]);
          withTenant.write("graph's, written");
          plain.write("script's, written by the plain graph");
          const afterWrites = instances.map(instance => instance.read()[0]);
          const shadowing = await new ModuleGraph({ globals: { lateLexical: "graph's" } }).import(file);

          console.log(JSON.stringify({
            before,
            after,
            afterWrites,
            script: new vm.Script("tenant").runInThisContext(),
            shadowing: [shadowing.read(), shadowing.hot(10)],
          }));
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.mjs"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        before: [
          ["ReferenceError", 0],
          ["ReferenceError", 0],
          ["ReferenceError", 0],
        ],
        after: [
          [["graph's", 1], 20000],
          [["script", 1], 20000],
          [["script", 1], 20000],
        ],
        afterWrites: [
          "graph's, written",
          "script's, written by the plain graph",
          "script's, written by the plain graph",
        ],
        script: "script's, written by the plain graph",
        shadowing: [["script's, written by the plain graph", "graph's"], 0],
      });
      expect(exitCode).toBe(0);
    });

    test("a graph without a name does not see another graph's", async () => {
      using dir = tempDir("module-graph-globals-other-graph", {
        "other-graph.mjs": `
          export const read = () => tenant;
          export const types = () => [typeof tenant, typeof region];
        `,
      });
      const file = join(String(dir), "other-graph.mjs");
      using both = new ModuleGraph({ globals: { tenant: "a", region: "us" } });
      using regionOnly = new ModuleGraph({ globals: { region: "eu" } });
      using none = new ModuleGraph();
      const inBoth = await both.import(file);
      const inRegionOnly = await regionOnly.import(file);
      const inNone = await none.import(file);

      expect([inBoth.types(), inRegionOnly.types(), inNone.types()]).toEqual([
        ["string", "string"],
        ["undefined", "string"],
        ["undefined", "undefined"],
      ]);
      expect(inBoth.read()).toBe("a");
      expect(inRegionOnly.read).toThrow(ReferenceError);
      expect(inNone.read).toThrow(ReferenceError);
    });

    test("graphs with the same names in a different order behave identically", async () => {
      using dir = tempDir("module-graph-globals-order", {
        "order.mjs": `
          export const read = () => ({ x, y, z });
          export const rotate = () => { [x, y, z] = [y, z, x]; };
        `,
      });
      const file = join(String(dir), "order.mjs");
      using a = new ModuleGraph({ globals: { x: "ax", y: "ay", z: "az" } });
      using b = new ModuleGraph({ globals: { z: "bz", y: "by", x: "bx" } });
      using c = new ModuleGraph({ globals: { y: "cy", z: "cz", x: "cx" } });
      const [inA, inB, inC] = [await a.import(file), await b.import(file), await c.import(file)];

      expect([inA.read(), inB.read(), inC.read()]).toEqual([
        { x: "ax", y: "ay", z: "az" },
        { x: "bx", y: "by", z: "bz" },
        { x: "cx", y: "cy", z: "cz" },
      ]);
      inB.rotate();
      expect([inA.read(), inB.read(), inC.read()]).toEqual([
        { x: "ax", y: "ay", z: "az" },
        { x: "by", y: "bz", z: "bx" },
        { x: "cx", y: "cy", z: "cz" },
      ]);
    });

    test("one name being a prefix or superset of another graph's names", async () => {
      using dir = tempDir("module-graph-globals-name-sets", {
        "name-sets.mjs": `export const types = () => [typeof a, typeof ab, typeof b, typeof a1b];`,
      });
      const file = join(String(dir), "name-sets.mjs");
      const sets: Record<string, unknown>[] = [
        { a: 1, b: 1 },
        { ab: 1 },
        { a: 1, ab: 1, b: 1 },
        { a1b: 1 },
        { "a:1": 1, b: 1 },
        { a: 1 },
      ];

      const results = [];
      for (const globals of sets) {
        using graph = new ModuleGraph({ globals });
        results.push((await graph.import(file)).types());
      }
      const [n, u] = ["number", "undefined"];
      expect(results).toEqual([
        [n, u, n, u],
        [u, n, u, u],
        [n, n, n, u],
        [u, u, u, n],
        [u, u, n, u],
        [n, u, u, u],
      ]);
    });
  });

  describe("scale", () => {
    test("500 names", async () => {
      const names = Array.from({ length: 500 }, (_, i) => `name${i}`);
      using dir = tempDir("module-graph-globals-many-names", {
        "many-names.mjs": `
          export const read = () => [${names.join(", ")}];
          export const bump = () => { ${names.map(name => `${name}++;`).join(" ")} };
        `,
      });
      const file = join(String(dir), "many-names.mjs");
      using a = new ModuleGraph({ globals: Object.fromEntries(names.map((name, i) => [name, i])) });
      using b = new ModuleGraph({ globals: Object.fromEntries(names.toReversed().map((name, i) => [name, -i])) });
      const inA = await a.import(file);
      const inB = await b.import(file);
      inA.bump();

      expect(inA.read()).toEqual(names.map((_, i) => i + 1));
      expect(inB.read()).toEqual(names.map((_, i) => -(499 - i)));
    });

    test("100 graphs keep their own values across a full collection", async () => {
      using dir = tempDir("module-graph-globals-many-graphs", {
        "many-graphs.mjs": `
          export const read = () => [id, payload.id, typeof only];
          export const bump = () => { id += 1000; };
        `,
      });
      const file = join(String(dir), "many-graphs.mjs");
      async function load(id: number) {
        // Every tenth graph has a different set of names, so not all of them share one layout.
        const graph = new ModuleGraph({ globals: { id, payload: { id }, ...(id % 10 === 0 ? { only: true } : {}) } });
        return await graph.import(file);
      }
      const instances = [];
      for (let id = 0; id < 100; id++) instances.push(await load(id));
      Bun.gc(true);
      for (const instance of instances) if (instance.read()[0] % 2) instance.bump();
      Bun.gc(true);

      expect(instances.map(instance => instance.read())).toEqual(
        Array.from({ length: 100 }, (_, id) => [id % 2 ? id + 1000 : id, id, id % 10 === 0 ? "boolean" : "undefined"]),
      );
    });

    test("a set of names can be used again after every graph that had it is collected", async () => {
      using dir = tempDir("module-graph-globals-names-reused", {
        "names-reused.mjs": `
          export function sum(n) { let total = 0; for (let i = 0; i < n; i++) total += reusedName; return total; }
        `,
      });
      const file = join(String(dir), "names-reused.mjs");
      async function round(value: number) {
        const graph = new ModuleGraph({ globals: { reusedName: value } });
        return (await graph.import(file)).sum(10_000);
      }

      const sums = [];
      for (let value = 0; value < 5; value++) {
        sums.push(await round(value));
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
        Bun.gc(true);
      }
      expect(sums).toEqual([0, 10_000, 20_000, 30_000, 40_000]);
    });

    test("values are kept alive by the graph's code alone", async () => {
      using dir = tempDir("module-graph-globals-keeps-values-alive", {
        "keeps-values-alive.mjs": `export const read = () => payload.text;`,
      });
      const file = join(String(dir), "keeps-values-alive.mjs");
      async function load() {
        const graph = new ModuleGraph({ globals: { payload: { text: Buffer.alloc(1024, "p").toString() } } });
        return (await graph.import(file)).read;
      }
      const read = await load();
      Bun.gc(true);

      expect(read()).toBe(Buffer.alloc(1024, "p").toString());
    });
  });
});
