import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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
});

// When `useDefineForClassFields` is not set, tsc (and esbuild) derive it from
// `target`: `false` below ES2022, `true` from ES2022 on.
describe("tsconfig compilerOptions.target implies useDefineForClassFields", () => {
  const probe = `
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
  `;
  const setSemantics = { setterCalled: true, p: "getter", ownP: false, hasB: false };
  const defineSemantics = { setterCalled: false, p: "field", ownP: true, hasB: true };

  const cases: [compilerOptions: Record<string, unknown>, expected: typeof setSemantics][] = [
    [{ target: "ES2021" }, setSemantics],
    [{ target: "es5" }, setSemantics],
    [{ target: "ES2022" }, defineSemantics],
    [{ target: "ESNext" }, defineSemantics],
    [{ target: "ES2017", useDefineForClassFields: true }, defineSemantics],
    [{ target: "ES2022", useDefineForClassFields: false }, setSemantics],
  ];

  for (const [compilerOptions, expected] of cases) {
    const name = JSON.stringify(compilerOptions);
    const semantics = expected === setSemantics ? "[[Set]]" : "[[Define]]";

    test.concurrent(`${name}: bun run uses ${semantics}`, async () => {
      using dir = tempDir("udfcf-target", {
        "tsconfig.json": JSON.stringify({ compilerOptions }),
        "index.ts": probe,
      });
      const { stdout, stderr, exitCode } = await run(String(dir));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(expected);
      expect(exitCode).toBe(0);
    });

    test.concurrent(`${name}: bun build uses ${semantics}`, async () => {
      using dir = tempDir("udfcf-target-build", {
        "tsconfig.json": JSON.stringify({ compilerOptions }),
        "index.ts": probe,
      });
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "index.ts", "--outfile", "out.js"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [, buildStderr, buildExitCode] = await Promise.all([
        build.stdout.text(),
        build.stderr.text(),
        build.exited,
      ]);
      expect(buildStderr).toBe("");
      expect(buildExitCode).toBe(0);

      const { stdout, stderr, exitCode } = await run(String(dir), "out.js");
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(expected);
      expect(exitCode).toBe(0);
    });
  }

  test.concurrent("target below ES2022 is inherited through extends", async () => {
    using dir = tempDir("udfcf-target-extends", {
      "base.json": JSON.stringify({ compilerOptions: { target: "ES2017" } }),
      "tsconfig.json": JSON.stringify({ extends: "./base.json", compilerOptions: { strict: true } }),
      "index.ts": probe,
    });
    const { stdout, stderr, exitCode } = await run(String(dir));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(setSemantics);
    expect(exitCode).toBe(0);
  });

  test.concurrent("an inherited explicit useDefineForClassFields wins over the child's target", async () => {
    using dir = tempDir("udfcf-target-extends-explicit", {
      "base.json": JSON.stringify({ compilerOptions: { useDefineForClassFields: true } }),
      "tsconfig.json": JSON.stringify({ extends: "./base.json", compilerOptions: { target: "ES2017" } }),
      "index.ts": probe,
    });
    const { stdout, stderr, exitCode } = await run(String(dir));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(defineSemantics);
    expect(exitCode).toBe(0);
  });

  // tsc emits `design:paramtypes` only for a constructor written in the source.
  // The constructor synthesized for lowered fields must not shadow the parent's
  // metadata, or dependency injection (NestJS) loses the inherited types.
  for (const compilerOptions of [{ target: "ES2021" }, { useDefineForClassFields: false }]) {
    test.concurrent(
      `${JSON.stringify(compilerOptions)}: synthesized constructor has no design:paramtypes`,
      async () => {
        using dir = tempDir("udfcf-target-metadata", {
          "tsconfig.json": JSON.stringify({
            compilerOptions: { ...compilerOptions, experimentalDecorators: true, emitDecoratorMetadata: true },
          }),
          "index.ts": `
          const store = new WeakMap<object, Map<string, unknown>>();
          (Reflect as any).metadata = (key: string, value: unknown) => (target: object) => {
            if (!store.has(target)) store.set(target, new Map());
            store.get(target)!.set(key, value);
          };
          const own = (target: object) => store.get(target)?.get("design:paramtypes") as Function[] | undefined;
          const inherited = (target: object) => {
            for (let t: object | null = target; t; t = Object.getPrototypeOf(t)) {
              const types = own(t);
              if (types) return types;
            }
          };
          const names = (types?: Function[]) => types?.map(t => t.name) ?? null;

          function Injectable(): ClassDecorator { return () => {}; }
          class Dep {}
          @Injectable() class Base { constructor(public dep: Dep) {} }
          @Injectable() class Declared extends Base { label: string; }
          @Injectable() class Initialized extends Base { name = "x"; }
          @Injectable() class Explicit extends Base { constructor(d: Dep, n: number) { super(d); } }

          const report = (cls: any) => ({
            own: names(own(cls)),
            inherited: names(inherited(cls)),
            keys: Object.getOwnPropertyNames(new cls(new Dep(), 1)),
          });
          process.stdout.write(JSON.stringify({
            Declared: report(Declared),
            Initialized: report(Initialized),
            Explicit: report(Explicit),
          }));
        `,
        });
        const { stdout, stderr, exitCode } = await run(String(dir));
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual({
          Declared: { own: null, inherited: ["Dep"], keys: ["dep"] },
          Initialized: { own: null, inherited: ["Dep"], keys: ["dep", "name"] },
          Explicit: { own: ["Dep", "Number"], inherited: ["Dep", "Number"], keys: ["dep"] },
        });
        expect(exitCode).toBe(0);
      },
    );
  }

  test.concurrent("Bun.Transpiler derives the default from target", () => {
    const source = `
      class A {
        v = this.x + 1;
        constructor(public x: number) {}
      }
    `;
    const below = new Bun.Transpiler({ loader: "ts", tsconfig: { compilerOptions: { target: "ES2021" } } });
    expect(below.transformSync(source)).toContain("this.v = this.x + 1");

    const atOrAbove = new Bun.Transpiler({ loader: "ts", tsconfig: { compilerOptions: { target: "ES2022" } } });
    expect(atOrAbove.transformSync(source)).not.toContain("this.v = this.x + 1");
  });
});
