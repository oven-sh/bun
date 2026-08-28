import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir } from "harness";
import { join } from "node:path";

// TypeScript "experimentalDecorators" lowering. Every fixture runs three ways:
// with `bun <file>`, bundled and minified with `Bun.build`, and as the
// JavaScript tsc emits for it, run with node. All three must print the same
// thing, so the expected output is tsc's behavior.

interface Fixture {
  source: string;
  expected: string;
  useDefineForClassFields?: boolean;
  /** Extra files next to index.ts. */
  files?: Record<string, string>;
}

const fixtures: Record<string, Fixture> = {
  "decorated fields stay in place: init order, this, super, no initializer": {
    source: `
      function dec(t: any, k?: any, d?: any) {}
      class Base { static x = 5 }
      class A extends Base {
        static a = (console.log("a"), 1); @dec static b = (console.log("b"), 2); static c = (console.log("c"), A.b);
        @dec static t = this.a;
        @dec static s = super.x;
        x = (console.log("x"), 1); @dec y = (console.log("y"), 2); z = (console.log("z"), 3);
        @dec w;
      }
      new A();
      const a: any = new A();
      console.log(A.c, A.t, A.s, "w" in a, Object.getOwnPropertyDescriptor(a, "y")?.value);
    `,
    expected: "a\nb\nc\nx\ny\nz\nx\ny\nz\n2 1 5 true 2\n",
  },
  "useDefineForClassFields false: decorated fields follow [[Set]] semantics too": {
    useDefineForClassFields: false,
    source: `
      function dec(t: any, k?: any, d?: any) {}
      class Base { static x = 5; set y(v: any) { console.log("setter", v) } get y() { return "getter" } }
      class A extends Base {
        static a = (console.log("a"), 1); @dec static b = (console.log("b"), 2); static c = (console.log("c"), A.b);
        x = (console.log("x"), 1); @dec y = (console.log("y"), 2); z = (console.log("z"), 3);
        @dec w;
      }
      const a: any = new A();
      console.log(A.c, "w" in a, a.y, Object.hasOwn(a, "y"));
    `,
    expected: "a\nb\nc\nx\ny\nsetter 2\nz\n2 false getter false\n",
  },
  "computed keys are evaluated once and the decorator sees the same key": {
    source: `
      let n = 0; const key = () => "k" + ++n;
      function d2(t: any, p: string) { console.log("decorating", p) }
      class F { @d2 [key()]() {}  @d2 [key()] = 1 }
      new F(); new F();
      console.log(n, JSON.stringify(Object.getOwnPropertyNames(F.prototype)), JSON.stringify(Object.keys(new F())));
    `,
    expected: 'decorating k1\ndecorating k2\n2 ["constructor","k1"] ["k2"]\n',
  },
  "a decorated declare field is dropped but its computed key still runs once": {
    source: `
      function dec(t: any, k: any) { console.log("dec", String(k)) }
      let n = 0; const k = () => "k" + ++n;
      class A { @dec declare [k()]: number; @dec declare d: number; x = 1 }
      console.log(n, JSON.stringify(Object.getOwnPropertyNames(new A())));
    `,
    expected: 'dec k1\ndec d\n1 ["x"]\n',
  },
  "useDefineForClassFields false: decorated fields next to a computed key": {
    useDefineForClassFields: false,
    source: `
      function dec(t: any, k: any) { console.log("dec", String(k)) }
      const s = Symbol("s");
      class A { @dec w: number; [s] = 1; @dec [Symbol.iterator]: any; y = 2 }
      const a: any = new A();
      console.log(JSON.stringify([a.y, a[s], a.w, a[Symbol.iterator]]));
    `,
    // Bun keeps a class with a computed instance key native instead of hoisting
    // the key like tsc, so "w" is an own property here and not with tsc. The
    // values and the decorator calls agree.
    expected: "dec w\ndec Symbol(Symbol.iterator)\n[2,1,null,null]\n",
  },
  "a parameter decorator is evaluated in the scope around the class": {
    source: `
      function pd(v: any) { console.log("dec arg =", v); return (...a: any[]) => {} }
      let arg = 1;
      class P { m(@pd(arg) arg = 2) { return arg } }
      console.log(new P().m());
    `,
    expected: "dec arg = 1\n2\n",
  },
  "a parameter decorator can await or yield in the enclosing function": {
    source: `
      function pd(v: any) { console.log("dec arg =", v); return (...a: any[]) => {} }
      async function f(foo: Promise<number>) { class C { m(@pd(await foo) a: any) {} } return new C() }
      await f(Promise.resolve(42));
      function* g() { class D { *m(@pd(yield 1) a: any) {} } return new D() }
      const it = g(); console.log(it.next().value, it.next(43).done);
      console.log("done");
    `,
    expected: "dec arg = 42\ndec arg = 43\n1 true\ndone\n",
  },
  "decorators that read a static #private name run inside the class": {
    source: `
      function pd(v: any) { console.log("dec arg =", v); return (...a: any[]) => {} }
      class Q {
        static #p = 1;
        static { console.log("static block") }
        m(@pd(Q.#p) a: any) {}
        @pd(Q.#p + 1) b: any;
        @pd(new (class { read() { return Q.#p + 2 } })().read()) c: any;
        static #q = (console.log("static field"), 2);
      }
      console.log(Object.getOwnPropertyNames(Q.prototype).join(","));
    `,
    expected: "static block\nstatic field\ndec arg = 1\ndec arg = 2\ndec arg = 3\nconstructor,m\n",
  },
  "a private name of another class in a decorator keeps the calls outside": {
    source: `
      function dec(...a: any[]) { return (...b: any[]) => {} }
      class Other { static #p = 1; static read() { return Other.#p } }
      class C {
        @dec(class { #id = 7; get() { return this.#id } }) x = 1;
        @dec(Other.read()) y = 2;
      }
      console.log(Object.keys(new C()).join(","));
    `,
    expected: "x,y\n",
  },
  "export default @dec class keeps the binding and applies the decorator": {
    files: {
      "mod.ts": `
        function cd(cls: any) { console.log("decorated", cls.x); return class extends cls { static y = 2 } }
        export default @cd class Bar { static x = 1 }
        console.log(Bar.x, Bar.y);
      `,
    },
    source: `
      import Bar from "./mod";
      console.log(Bar.x, Bar.y);
    `,
    expected: "decorated 1\n1 2\n1 2\n",
  },
  "accessor fields are lowered and can be decorated": {
    source: `
      function dec(t: any, k: any, d: any) { console.log("dec", String(k), typeof d.get, typeof d.set) }
      const sym = Symbol("s");
      class Acc {
        accessor y = 2;
        @dec accessor z = 3;
        @dec static accessor s: string;
        @dec accessor [sym] = 4;
        accessor #p = 5;
        p() { return this.#p }
      }
      const a = new Acc();
      console.log(a.y, a.z, Acc.s, a[sym], a.p());
      a.y = 20; a.z = 30; Acc.s = "s"; a[sym] = 40;
      console.log(a.y, a.z, Acc.s, a[sym]);
      console.log(JSON.stringify(Object.getOwnPropertyNames(a)), JSON.stringify(Object.getOwnPropertyNames(Acc.prototype)));
    `,
    expected:
      'dec z function function\ndec Symbol(s) function function\ndec s function function\n2 3 undefined 4 5\n20 30 s 40\n[] ["constructor","y","z","p"]\n',
  },
  "accessor storage names stay unique and class expressions are lowered too": {
    source: `
      class A {
        accessor x = 1;
        static accessor x = 2;
        accessor #x = 3;
        #x_accessor_storage = 4;
        get(): number[] { return [this.x, A.x, this.#x, this.#x_accessor_storage] }
      }
      const k = () => "k";
      const B = class { accessor y = 5; accessor [k()] = 7 };
      const b: any = new B();
      b.y += 1;
      console.log(JSON.stringify([new A().get(), b.y, b.k, Object.getOwnPropertyNames(b).length]));
    `,
    expected: "[[1,2,3,4],6,7,0]\n",
  },
};

function tsconfig(useDefineForClassFields: boolean | undefined) {
  return JSON.stringify({
    compilerOptions: {
      experimentalDecorators: true,
      ...(useDefineForClassFields === undefined ? {} : { useDefineForClassFields }),
    },
  });
}

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Runs in node: transpiles every .ts file in the directory with the typescript
// package, then imports index.mjs. Loading typescript in a debug build of bun
// takes far longer than a test may.
const tscEmitAndRun = `
  const fs = require("node:fs");
  const path = require("node:path");
  const ts = require(process.argv[2]);
  const useDefineForClassFields = process.argv[3] === "" ? undefined : process.argv[3] === "true";
  for (const file of fs.readdirSync(".")) {
    if (!file.endsWith(".ts")) continue;
    const out = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText;
    fs.writeFileSync(file.replace(/\\.ts$/, ".mjs"), out.replaceAll(/from "(\\.\\/[^"]+)"/g, 'from "$1.mjs"'));
  }
  import("file://" + path.resolve("index.mjs"));
`;
const typescriptPath = require.resolve("typescript");

describe("experimentalDecorators lowering", () => {
  for (const [name, fixture] of Object.entries(fixtures)) {
    const files = {
      "tsconfig.json": tsconfig(fixture.useDefineForClassFields),
      "index.ts": fixture.source,
      ...fixture.files,
    };

    test(`${name} (bun)`, async () => {
      using dir = tempDir("legacy-dec-run", files);
      const { stdout, stderr, exitCode } = await run([bunExe(), "index.ts"], String(dir));
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: fixture.expected, stderr: "", exitCode: 0 });
    });

    test(`${name} (bundled and minified)`, async () => {
      using dir = tempDir("legacy-dec-build", files);
      const build = await Bun.build({
        entrypoints: [join(String(dir), "index.ts")],
        outdir: join(String(dir), "out"),
        minify: true,
      });
      expect(build.logs).toEqual([]);
      const { stdout, stderr, exitCode } = await run([bunExe(), "out/index.js"], String(dir));
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: fixture.expected, stderr: "", exitCode: 0 });
    });

    test.skipIf(!nodeExe())(`${name} (tsc emit)`, async () => {
      // The reference: tsc's own output for the same source, run as plain JavaScript.
      using dir = tempDir("legacy-dec-tsc", { ...files, "tsc-emit-and-run.cjs": tscEmitAndRun });
      const { stdout, stderr, exitCode } = await run(
        [nodeExe()!, "tsc-emit-and-run.cjs", typescriptPath, String(fixture.useDefineForClassFields ?? "")],
        String(dir),
      );
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: fixture.expected, stderr: "", exitCode: 0 });
    });
  }

  test("decorated auto-accessor and declare fields get design:type metadata", async () => {
    using dir = tempDir("legacy-dec-metadata", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true },
      }),
      "index.ts": `
        (Reflect as any).metadata = (key: string, value: any) => (target: any, prop: string) => {
          console.log(prop, key, value.name);
        };
        function dec(t: any, k: any, d: any) {}
        class Acc {
          @dec accessor n: number = 1;
          @dec accessor s: string;
          @dec declare d: boolean;
        }
        console.log(new Acc().n, "d" in new Acc());
      `,
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "index.ts"], String(dir));
    expect(stderr).toBe("");
    expect(stdout).toBe("n design:type Number\ns design:type String\nd design:type Boolean\n1 false\n");
    expect(exitCode).toBe(0);
  });

  test("decorators on a class expression are a syntax error", async () => {
    using dir = tempDir("legacy-dec-class-expr", {
      "tsconfig.json": tsconfig(undefined),
      "before.ts": `
        function cd(cls: any) {}
        const X = @cd class Y {};
      `,
      "member.ts": `
        function dec(t: any, k?: any) {}
        const X = class Y { @dec x = 1 };
      `,
      "param.ts": `
        function dec(t: any, k?: any, i?: any) {}
        const X = class { m(@dec a: any) {} };
      `,
    });
    const [before, member, param] = await Promise.all([
      run([bunExe(), "before.ts"], String(dir)),
      run([bunExe(), "member.ts"], String(dir)),
      run([bunExe(), "param.ts"], String(dir)),
    ]);
    expect(before.stderr).toContain("TypeScript experimental decorators cannot be used in expression position");
    expect(before.exitCode).not.toBe(0);
    expect(member.stderr).toContain("TypeScript experimental decorators can only be used with class declarations");
    expect(member.exitCode).not.toBe(0);
    expect(param.stderr).toContain("TypeScript experimental decorators can only be used with class declarations");
    expect(param.exitCode).not.toBe(0);
  });

  test("decorators on both sides of export default are rejected", async () => {
    using dir = tempDir("legacy-dec-double", {
      "tsconfig.json": tsconfig(undefined),
      "index.ts": `
        function cd(cls: any) {}
        @cd export default @cd class Foo {}
      `,
    });
    const { stderr, exitCode } = await run([bunExe(), "index.ts"], String(dir));
    expect(stderr).toContain("Decorators are not valid here");
    expect(exitCode).not.toBe(0);
  });

  test("Bun.Transpiler output shape matches tsc", async () => {
    const transpiler = new Bun.Transpiler({
      loader: "ts",
      tsconfig: { compilerOptions: { experimentalDecorators: true } },
    });
    // A private name of another class does not move the calls into a static
    // block, so `await` in a sibling decorator keeps working.
    expect(
      transpiler.transformSync(`
        class C {
          @dec(class { #id = 7; get() { return this.#id } }) x = 1;
          @dec(await p) y = 2;
        }
      `),
    ).not.toContain("static {");
    const out = transpiler.transformSync(`
      function dec(t: any, k?: any, d?: any) {}
      let n = 0; const key = () => "k" + ++n;
      class A {
        static #p = 1;
        @dec static a = this.x;
        @dec b;
        @dec [key()] = 2;
        accessor c = 3;
        m(@dec(A.#p) arg = 1) {}
      }
    `);
    // Fields stay in the body, computed keys are captured once, and the
    // decorator calls run in a static block because one reads `A.#p`.
    expect(out).toMatchInlineSnapshot(`
      "import { __legacyDecorateClassTS as __legacyDecorateClassTS_3r173x8m, __legacyDecorateParamTS as __legacyDecorateParamTS_1ycx8dha } from "bun:wrap";
      function dec(t, k, d) {}
      let n = 0;
      const key = () => "k" + ++n;
      var __bun_temp_ref_1$;

      class A {
        static #p = 1;
        static a = this.x;
        b;
        [__bun_temp_ref_1$ = key()] = 2;
        #c_accessor_storage = 3;
        get c() {
          return this.#c_accessor_storage;
        }
        set c(v) {
          this.#c_accessor_storage = v;
        }
        m(arg = 1) {}
        static {
          __legacyDecorateClassTS_3r173x8m([
            dec
          ], A.prototype, "b", undefined);
          __legacyDecorateClassTS_3r173x8m([
            dec
          ], A.prototype, __bun_temp_ref_1$, undefined);
          __legacyDecorateClassTS_3r173x8m([
            __legacyDecorateParamTS_1ycx8dha(0, dec(A.#p))
          ], A.prototype, "m", null);
          __legacyDecorateClassTS_3r173x8m([
            dec
          ], A, "a", undefined);
        }
      }
      "
    `);
  });
});
