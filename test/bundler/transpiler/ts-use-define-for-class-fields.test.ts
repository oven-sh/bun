import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// With `useDefineForClassFields: false` TypeScript lowers instance fields to
// `this.x = init` in the constructor, after parameter-property assignments.
// https://github.com/oven-sh/bun/issues/10961

async function run(dir: string, entry = "index.ts") {
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("tsconfig compilerOptions.useDefineForClassFields", () => {
  test.concurrent("false: field initializers see parameter properties (#10961)", async () => {
    using dir = tempDir("udfcf-param-prop", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }),
      "index.ts": `
        class Logger { createChildContext(n: string) { return new Logger(); } }
        class PlayerManager { constructor(public log: Logger) {} }
        class GameServer {
          private _playerManager = new PlayerManager(this._log.createChildContext("pm"));
          constructor(private _log: Logger) {}
          get playerManager() { return this._playerManager; }
        }
        const gs = new GameServer(new Logger());
        console.log(gs.playerManager instanceof PlayerManager);
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir));
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("true");
    expect(exitCode).toBe(0);
  });

  test.concurrent("false: matches tsc/esbuild ordering and [[Set]] semantics", async () => {
    using dir = tempDir("udfcf-order", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }),
      "index.ts": `
        const order: string[] = [];
        let setterCalled = false;
        class Base {
          set p(v: any) { setterCalled = true; }
          get p() { return "getter"; }
          constructor(..._a: any[]) { order.push("Base"); }
        }
        class Derived extends Base {
          a = (order.push("a"), this.x + 1);
          b: number;
          p: any = "field";
          #d = (order.push("#d"), 7);
          constructor(public x: number) { super(x); order.push("ctor"); }
          getD() { return this.#d; }
        }
        const d = new Derived(10);
        process.stdout.write(JSON.stringify({
          order,
          a: d.a,
          hasB: "b" in d,
          p: d.p,
          setterCalled,
          priv: d.getD(),
        }));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      order: ["Base", "a", "#d", "ctor"],
      a: 11,
      hasB: false,
      p: "getter",
      setterCalled: true,
      priv: 7,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("false: synthesizes constructor when none is declared", async () => {
    using dir = tempDir("udfcf-synth", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }),
      "index.ts": `
        class NoCtor { a = 1; b: number; }
        class ExtNoCtor extends NoCtor { c = this.a + 1; }
        const e = new ExtNoCtor();
        process.stdout.write(JSON.stringify({ a: e.a, c: e.c, hasB: "b" in e }));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ a: 1, c: 2, hasB: false });
    expect(exitCode).toBe(0);
  });

  test.concurrent("false: computed literal keys use [[Set]] semantics", async () => {
    using dir = tempDir("udfcf-computed", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }),
      "index.ts": `
        let sets = 0;
        class Base { set lit(v: any) { sets++; } get lit() { return "g"; } }
        class C extends Base {
          ["lit"]: any = this.x;
          [0] = this.x * 2;
          constructor(public x: number) { super(); }
        }
        const c = new C(3);
        process.stdout.write(JSON.stringify({ sets, lit: c.lit, zero: c[0] }));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ sets: 1, lit: "g", zero: 6 });
    expect(exitCode).toBe(0);
  });

  test.concurrent("false: computed non-literal key keeps the class native", async () => {
    using dir = tempDir("udfcf-computed-dyn", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }),
      "index.ts": `
        const order: string[] = [];
        const K = Symbol();
        class C {
          a = (order.push("a"), 1);
          [K]: any = (order.push("K"), this.a);
          b = (order.push("b"), 2);
        }
        const c: any = new C();
        let called = 0;
        const key = () => (called++, "k");
        class D { [key()]: any; a = 1; }
        new D();
        new D();
        process.stdout.write(JSON.stringify({ order, K: c[K], called }));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ order: ["a", "K", "b"], K: 1, called: 1 });
    expect(exitCode).toBe(0);
  });

  for (const explicit of [true, false]) {
    test.concurrent(`${explicit ? "true" : "unset"}: keeps native class-field ([[Define]]) semantics`, async () => {
      using dir = tempDir("udfcf-define", {
        "tsconfig.json": JSON.stringify({
          compilerOptions: explicit ? { useDefineForClassFields: true } : {},
        }),
        "index.ts": `
          let setterCalled = false;
          class Base { set p(v: any) { setterCalled = true; } get p() { return "getter"; } }
          class C extends Base { p: any = "field"; b: number; }
          const c = new C();
          process.stdout.write(JSON.stringify({
            setterCalled,
            p: c.p,
            ownP: Object.prototype.hasOwnProperty.call(c, "p"),
            hasB: "b" in c,
          }));
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ setterCalled: false, p: "field", ownP: true, hasB: true });
      expect(exitCode).toBe(0);
    });
  }

  test.concurrent("false: standard-decorated field keeps its initializer for the decorator", async () => {
    using dir = tempDir("udfcf-std-dec", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }),
      "index.ts": `
        function dec(_v: any, _ctx: any) { return (v: any) => v * 10; }
        class C {
          @dec a = 1;
          constructor(public x: number) {}
        }
        process.stdout.write(JSON.stringify({ a: new C(5).a }));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ a: 10 });
    expect(exitCode).toBe(0);
  });

  test.concurrent("false: static method named 'constructor' is not treated as the constructor", async () => {
    using dir = tempDir("udfcf-static-ctor", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }),
      "index.ts": `
        class C {
          x = 1;
          static constructor() { return "static"; }
        }
        process.stdout.write(JSON.stringify({ x: new C().x, s: C.constructor() }));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ x: 1, s: "static" });
    expect(exitCode).toBe(0);
  });

  test.concurrent("false: decorated field initializers also see parameter properties", async () => {
    using dir = tempDir("udfcf-decorated", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { useDefineForClassFields: false, experimentalDecorators: true },
      }),
      "index.ts": `
        let decorated: string | undefined;
        function dec(_t: any, k: string) { decorated = k; }
        const order: string[] = [];
        class Foo {
          @dec a = (order.push("a=" + this.x), this.x);
          b = (order.push("b=" + this.x), this.x);
          constructor(public x: number) { order.push("ctor"); }
        }
        new Foo(5);
        process.stdout.write(JSON.stringify({ order, decorated }));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ order: ["a=5", "b=5", "ctor"], decorated: "a" });
    expect(exitCode).toBe(0);
  });

  test.concurrent("false: Bun.Transpiler honors the option", async () => {
    const t = new Bun.Transpiler({
      loader: "ts",
      tsconfig: { compilerOptions: { useDefineForClassFields: false } },
    });
    const out = t.transformSync(`
      class A {
        v = this.x + 1;
        constructor(public x: number) {}
      }
    `);
    expect(out).toContain("this.x = x");
    expect(out).toContain("this.v = this.x + 1");
    // No declaration-only native class field for the parameter property.
    expect(out).not.toMatch(/^\s*x;\s*$/m);
  });

  // tsc and esbuild move a `#private` initializer into the constructor only to keep its
  // place among the plain fields that they assign. The expected values are what their
  // output prints on Node (tsc 6.0.2 with target ES2022, esbuild 0.21.5).
  test.concurrent("false: a #private initializer stays a field unless a plain field is assigned", async () => {
    using dir = tempDir("udfcf-private", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }),
      "index.ts": `
        let seen: string[] = [];
        const t = (name: string) => (seen.push(name), name);
        const ran = (make: () => unknown) => {
          seen = [];
          try { make(); } catch (error) { t((error as Error).name); }
          return seen.join();
        };

        class Alone {
          #id = t("#id");
          constructor(public seq = t("seq")) { t("body"); }
          id() { return this.#id; }
        }
        class Two {
          #a = t("#a");
          #b = t("#b");
          constructor(public seq = t("seq")) { t("body"); }
          ab() { return this.#a + this.#b; }
        }
        class NoParameterProperty {
          #id = t("#id");
          constructor(seq = t("seq")) { t("body of " + seq); }
          id() { return this.#id; }
        }
        class BesideFieldWithoutValue {
          n?: number;
          #id = t("#id");
          constructor(public seq = t("seq")) { t("body"); }
          id() { return this.#id; }
        }
        class BesideStaticField {
          static s = t("s");
          #id = t("#id");
          constructor(public seq = t("seq")) { t("body"); }
          id() { return this.#id; }
        }
        const Expression = class {
          #id = t("#id");
          constructor(public seq = t("seq")) { t("body"); }
          id() { return this.#id; }
        };
        class Base {
          x = 0;
          constructor(public arg: string) { t("base"); }
        }
        class Derived extends Base {
          #id = t("#id");
          constructor(public seq = t("seq")) { super(t("super arg")); t("body"); }
          id() { return this.#id; }
        }
        class SuperInBranch extends Base {
          #id = t("#id");
          constructor(first: boolean) {
            // @ts-expect-error TS2401: tsc wants super() at the root of the body beside a private field
            if (first) super(t("first"));
            else super(t("second"));
            t("body");
          }
          id() { return this.#id; }
        }
        class AheadOfAssignedField {
          #id = t("#id");
          n = t("n");
          constructor(public seq = t("seq")) { t("body"); }
          id() { return this.#id; }
        }
        class BehindAssignedField {
          n = t("n");
          #id = t("#id");
          constructor(public seq = t("seq")) { t("body"); }
          id() { return this.#id; }
        }
        class ReadsParameterProperty {
          #read = this.x;
          constructor(public x: number) {}
          read() { return this.#read; }
        }
        class ReadsParameterPropertyBesideAssignedField {
          #read = this.x;
          n = 0;
          constructor(public x: number) {}
          read() { return this.#read; }
        }
        class DerivedReadsParameterProperty extends Base {
          #read = this.x;
          constructor(public x: number) { super(""); }
          read() { return this.#read; }
        }
        class Named {
          #f = () => {};
          name() { return this.#f.name; }
        }

        process.stdout.write(JSON.stringify({
          alone: ran(() => new Alone()),
          two: ran(() => new Two()),
          noParameterProperty: ran(() => new NoParameterProperty()),
          besideFieldWithoutValue: ran(() => new BesideFieldWithoutValue()),
          besideStaticField: ran(() => new BesideStaticField()),
          expression: ran(() => new Expression()),
          derived: ran(() => new Derived()),
          superInBranch: ran(() => new SuperInBranch(false)),
          aheadOfAssignedField: ran(() => new AheadOfAssignedField()),
          behindAssignedField: ran(() => new BehindAssignedField()),
          readsParameterProperty: String(new ReadsParameterProperty(5).read()),
          readsParameterPropertyBesideAssignedField: new ReadsParameterPropertyBesideAssignedField(5).read(),
          derivedReadsParameterProperty: new DerivedReadsParameterProperty(5).read(),
          name: new Named().name(),
          keys: Object.keys(new BesideFieldWithoutValue()),
        }));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      alone: "#id,seq,body",
      two: "#a,#b,seq,body",
      noParameterProperty: "#id,seq,body of seq",
      besideFieldWithoutValue: "#id,seq,body",
      besideStaticField: "#id,seq,body",
      expression: "#id,seq,body",
      derived: "seq,super arg,base,#id,body",
      superInBranch: "second,base,#id,body",
      aheadOfAssignedField: "seq,#id,n,body",
      behindAssignedField: "seq,n,#id,body",
      readsParameterProperty: "undefined",
      readsParameterPropertyBesideAssignedField: 5,
      derivedReadsParameterProperty: 0,
      name: "#f",
      keys: ["seq"],
    });
    expect(exitCode).toBe(0);
  });

  // The expected values are what the output of tsc 6.0.2 prints on Node, at every target:
  // a class has `design:paramtypes` of its own only if its source has a constructor.
  test.concurrent("false: a constructor that Bun adds for assigned fields has no design:paramtypes", async () => {
    using dir = tempDir("udfcf-paramtypes", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { useDefineForClassFields: false, experimentalDecorators: true, emitDecoratorMetadata: true },
      }),
      "index.ts": `
        // Stands for reflect-metadata: Reflect.getMetadata() asks the class, then each class it extends.
        const given = new Map<object, Map<string, Function[]>>();
        (Reflect as any).metadata = (key: string, value: Function[]) => (target: object) => {
          given.set(target, new Map(given.get(target)).set(key, value));
        };
        const names = (types: Function[] | undefined) =>
          types ? types.map(type => type.name).join() || "empty" : "none";
        const own = (target: object) => names(given.get(target)?.get("design:paramtypes"));
        function found(target: object | null): string {
          for (; target; target = Object.getPrototypeOf(target)) {
            const types = given.get(target)?.get("design:paramtypes");
            if (types) return names(types);
          }
          return "none";
        }
        function injectable(target: Function): void {}

        class Dep {}
        @injectable
        class Base {
          constructor(public dep: Dep) {}
        }
        @injectable
        class AssignsField extends Base {
          label = "x";
        }
        @injectable
        class AssignsFieldWithoutBase {
          label = "x";
        }
        @injectable
        class FieldWithoutValue extends Base {
          label?: string;
        }
        @injectable
        class PrivateField extends Base {
          #cache = new Map<string, number>();
          size() { return this.#cache.size; }
        }
        @injectable
        class WritesConstructor extends Base {
          label = "x";
          constructor() { super(new Dep()); }
        }
        @injectable
        class WritesParameters extends Base {
          label = "x";
          constructor(dep: Dep, public count: number) { super(dep); }
        }

        process.stdout.write(JSON.stringify({
          Base: [own(Base), found(Base)],
          AssignsField: [own(AssignsField), found(AssignsField), new AssignsField(new Dep()).label],
          AssignsFieldWithoutBase: [own(AssignsFieldWithoutBase), found(AssignsFieldWithoutBase)],
          FieldWithoutValue: [own(FieldWithoutValue), found(FieldWithoutValue)],
          PrivateField: [own(PrivateField), found(PrivateField), new PrivateField(new Dep()).size()],
          WritesConstructor: [own(WritesConstructor), found(WritesConstructor)],
          WritesParameters: [own(WritesParameters), found(WritesParameters)],
        }));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      Base: ["Dep", "Dep"],
      AssignsField: ["none", "Dep", "x"],
      AssignsFieldWithoutBase: ["none", "none"],
      FieldWithoutValue: ["none", "Dep"],
      PrivateField: ["none", "Dep", 0],
      WritesConstructor: ["empty", "empty"],
      WritesParameters: ["Dep,Number", "Dep,Number"],
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("false: Bun.Transpiler writes a constructor only for a field that it assigns", () => {
    const t = new Bun.Transpiler({
      loader: "ts",
      tsconfig: { compilerOptions: { useDefineForClassFields: false } },
    });
    const out = t.transformSync(`
      class Alone {
        #id = next();
        constructor(public seq = next()) {}
      }
      class BesideFieldWithoutValue extends Base {
        n?: number;
        #id = next();
      }
      class FieldWithoutValue {
        n?: number;
      }
      class BesideAssignedField {
        #id = next();
        n = next();
      }
    `);
    expect(out).toMatchInlineSnapshot(`
      "class Alone {
        #id = next();
        constructor(seq = next()) {
          this.seq = seq;
        }
      }

      class BesideFieldWithoutValue extends Base {
        #id = next();
      }

      class FieldWithoutValue {
      }

      class BesideAssignedField {
        constructor() {
          this.#id = next();
          this.n = next();
        }
        #id;
      }
      "
    `);
  });

  test.concurrent.each(["bun", "node", "browser"] as const)(
    "false: Bun.build keeps a lone #private initializer, target %s",
    async target => {
      using dir = tempDir("udfcf-build", {
        "tsconfig.json": JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }),
        "index.ts": `
          let n = 0;
          const next = () => ++n;
          class Alone {
            #id = next();
            constructor(public seq = next()) {}
            id() { return this.#id; }
          }
          const alone = new Alone();
          console.log(alone.id(), alone.seq);
        `,
      });
      const result = await Bun.build({ entrypoints: [join(String(dir), "index.ts")], target });
      expect(result.success).toBe(true);
      const text = await result.outputs[0].text();
      expect(text.slice(text.indexOf("class Alone"))).toBe(
        [
          "class Alone {",
          "  #id = next();",
          "  constructor(seq = next()) {",
          "    this.seq = seq;",
          "  }",
          "  id() {",
          "    return this.#id;",
          "  }",
          "}",
          "var alone = new Alone;",
          "console.log(alone.id(), alone.seq);",
          "",
        ].join("\n"),
      );
    },
  );
});
