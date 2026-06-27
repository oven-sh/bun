import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// ES standard decorators are used for .js files (always) and for .ts files
// when experimentalDecorators is NOT set in tsconfig.
// We test using .js files in temp directories to avoid inheriting
// the root tsconfig's experimentalDecorators: true setting.

function filterStderr(stderr: string) {
  // Filter out ASAN warnings that only appear in debug builds
  return stderr
    .split("\n")
    .filter(line => !line.startsWith("WARNING: ASAN"))
    .join("\n")
    .trim();
}

async function runDecorator(code: string) {
  using dir = tempDir("es-dec", {
    "test.js": code,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr: filterStderr(rawStderr), exitCode };
}

describe("ES Decorators", () => {
  describe("class decorators", () => {
    test("basic class decorator", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(cls, ctx) {
          ctx.addInitializer(function() {
            this.initialized = true;
          });
          return cls;
        }
        @dec class Foo {}
        const f = new Foo();
        console.log(Foo.initialized);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("true\n");
      expect(exitCode).toBe(0);
    });

    test("class decorator receives correct context", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(cls, ctx) {
          console.log(ctx.kind);
          console.log(ctx.name);
          console.log(typeof ctx.addInitializer);
          return cls;
        }
        @dec class MyClass {}
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("class\nMyClass\nfunction\n");
      expect(exitCode).toBe(0);
    });

    test("class decorator can replace class", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(cls, ctx) {
          return class extends cls {
            extra = true;
          };
        }
        @dec class Foo {
          original = true;
        }
        const f = new Foo();
        console.log(f.original, f.extra);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("true true\n");
      expect(exitCode).toBe(0);
    });

    test("multiple class decorators apply in reverse order", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const order = [];
        function dec1(cls, ctx) { order.push("dec1"); return cls; }
        function dec2(cls, ctx) { order.push("dec2"); return cls; }
        function dec3(cls, ctx) { order.push("dec3"); return cls; }
        @dec1 @dec2 @dec3 class Foo {}
        console.log(order.join(","));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("dec3,dec2,dec1\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("method decorators", () => {
    test("instance method decorator", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function log(fn, ctx) {
          return function(...args) {
            console.log("before", ctx.name);
            const result = fn.call(this, ...args);
            console.log("after", ctx.name);
            return result;
          };
        }
        class Foo {
          @log greet() { console.log("hello"); }
        }
        new Foo().greet();
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("before greet\nhello\nafter greet\n");
      expect(exitCode).toBe(0);
    });

    test("static method decorator", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(fn, ctx) {
          console.log(ctx.kind, ctx.name, ctx.static);
          return fn;
        }
        class Foo {
          @dec static bar() { return 42; }
        }
        console.log(Foo.bar());
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("method bar true\n42\n");
      expect(exitCode).toBe(0);
    });

    test("method decorator context has correct access", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        let savedAccess;
        function dec(fn, ctx) {
          savedAccess = ctx.access;
          return fn;
        }
        class Foo {
          @dec bar() { return 42; }
        }
        const f = new Foo();
        console.log(savedAccess.has(f));
        console.log(savedAccess.get(f)());
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("true\n42\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("getter decorators", () => {
    test("getter decorator", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(fn, ctx) {
          console.log(ctx.kind, ctx.name);
          return fn;
        }
        class Foo {
          @dec get x() { return 42; }
        }
        console.log(new Foo().x);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("getter x\n42\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("setter decorators", () => {
    test("setter decorator", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(fn, ctx) {
          console.log(ctx.kind, ctx.name);
          return fn;
        }
        class Foo {
          _val = 0;
          @dec set x(v) { this._val = v; }
        }
        const f = new Foo();
        f.x = 99;
        console.log(f._val);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("setter x\n99\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("field decorators", () => {
    test("field decorator receives undefined value", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) {
          console.log(ctx.kind, ctx.name, value);
          return undefined;
        }
        class Foo {
          @dec x = 42;
        }
        console.log(new Foo().x);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("field x undefined\n42\n");
      expect(exitCode).toBe(0);
    });

    test("multiple field decorators", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const order = [];
        function dec1(value, ctx) { order.push("dec1:" + ctx.name); }
        function dec2(value, ctx) { order.push("dec2:" + ctx.name); }
        class Foo {
          @dec1 @dec2 x = 1;
          @dec1 y = 2;
        }
        console.log(order.join(","));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("dec2:x,dec1:x,dec1:y\n");
      expect(exitCode).toBe(0);
    });

    test("static field decorator", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) {
          console.log(ctx.kind, ctx.name, ctx.static);
          return undefined;
        }
        class Foo {
          @dec static x = 10;
        }
        console.log(Foo.x);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("field x true\n10\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("non-ASCII string-literal keys", () => {
    // Supra-BMP code points are stored as UTF-16 in the AST; the lowering must
    // not reinterpret those bytes as UTF-8 when it builds `this[key]`.
    const key = "\u{20BB7}\u{91BB6}";

    test("Bun.Transpiler output preserves the key", () => {
      const t = new Bun.Transpiler({ loader: "js", target: "node", minifyWhitespace: true });
      const out = t.transformSync(`class A{@(() => {})\n"\\u{20BB7}\\u{91BB6}"\n}`);
      // The key appears twice in the lowered output (constructor assignment and
      // __decorateElement call) and must be the same string both times, either
      // as literal UTF-8 or as \uXXXX escapes of the correct surrogate pair.
      const normalized = out.replace(/\\uD842\\uDFB7\\uDA06\\uDFB6/gi, key);
      expect(normalized.split(key).length - 1).toBe(2);
      expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(out)).not.toThrow();
    });

    test("decorated instance field with supra-BMP key is assigned correctly", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) {
          console.log(ctx.kind, JSON.stringify(ctx.name));
          return (init) => init * 2;
        }
        class Foo {
          @dec "\\u{20BB7}\\u{91BB6}" = 21;
        }
        const f = new Foo();
        console.log(f[${JSON.stringify(key)}]);
        console.log(Object.getOwnPropertyNames(f).map(n => JSON.stringify(n)).join(","));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe(`field ${JSON.stringify(key)}\n42\n${JSON.stringify(key)}\n`);
      expect(exitCode).toBe(0);
    });

    test("decorated static field with supra-BMP key is assigned correctly", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return (init) => init + 1; }
        class Foo {
          @dec static "\\u{20BB7}\\u{91BB6}" = 9;
        }
        console.log(Foo[${JSON.stringify(key)}]);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("10\n");
      expect(exitCode).toBe(0);
    });

    test("decorated accessor with supra-BMP key works", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(target, ctx) {
          console.log(ctx.kind, JSON.stringify(ctx.name));
          return target;
        }
        class Foo {
          @dec accessor "\\u{20BB7}\\u{91BB6}" = 7;
        }
        const f = new Foo();
        console.log(f[${JSON.stringify(key)}]);
        f[${JSON.stringify(key)}] = 99;
        console.log(f[${JSON.stringify(key)}]);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe(`accessor ${JSON.stringify(key)}\n7\n99\n`);
      expect(exitCode).toBe(0);
    });

    test("undecorated accessor with supra-BMP key in a decorated class works", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(cls, ctx) { return cls; }
        @dec class Foo {
          accessor "\\u{20BB7}\\u{91BB6}" = 3;
        }
        const f = new Foo();
        console.log(f[${JSON.stringify(key)}]);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("3\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("decorator ordering", () => {
    test("decorators on different elements evaluate in source order", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const order = [];
        function track(name) {
          return function(value, ctx) {
            order.push(name + ":" + ctx.kind + ":" + ctx.name);
            return value;
          };
        }
        @track("cls")
        class Foo {
          @track("method") foo() {}
          @track("field") x = 1;
          @track("getter") get y() { return 2; }
          @track("setter") set y(v) {}
        }
        console.log(order.join("\\n"));
      `);
      expect(stderr).toBe("");
      expect(stdout).toContain("method:method:foo");
      expect(stdout).toContain("field:field:x");
      expect(stdout).toContain("getter:getter:y");
      expect(stdout).toContain("setter:setter:y");
      expect(stdout).toContain("cls:class:Foo");
      expect(exitCode).toBe(0);
    });
  });

  describe("decorator expressions", () => {
    test("member expression decorator", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const decorators = {
          log: function(fn, ctx) {
            console.log("decorated", ctx.name);
            return fn;
          }
        };
        class Foo {
          @decorators.log bar() {}
        }
        console.log("done");
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("decorated bar\ndone\n");
      expect(exitCode).toBe(0);
    });

    test("call expression decorator", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function withTag(tag) {
          return function(fn, ctx) {
            console.log(tag, ctx.name);
            return fn;
          };
        }
        class Foo {
          @withTag("hello") bar() {}
        }
        console.log("done");
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("hello bar\ndone\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("metadata", () => {
    test("Symbol.metadata is set on decorated class", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        // Symbol.metadata may not exist natively, use the same fallback as the runtime
        const metadataKey = Symbol.metadata || Symbol.for("Symbol.metadata");
        function dec(cls, ctx) { return cls; }
        @dec class Foo {}
        console.log(typeof Foo[metadataKey]);
        console.log(Foo[metadataKey] !== null);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("object\ntrue\n");
      expect(exitCode).toBe(0);
    });

    test("metadata inherits from parent class", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const metadataKey = Symbol.metadata || Symbol.for("Symbol.metadata");
        function dec(cls, ctx) {
          ctx.metadata.decorated = true;
          return cls;
        }
        @dec class Base {}
        @dec class Child extends Base {}
        console.log(Base[metadataKey].decorated);
        console.log(Child[metadataKey].decorated);
        console.log(Object.getPrototypeOf(Child[metadataKey]) === Base[metadataKey]);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("true\ntrue\ntrue\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("addInitializer", () => {
    test("class addInitializer runs after class is created", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const order = [];
        function dec(cls, ctx) {
          ctx.addInitializer(function() {
            order.push("initializer");
          });
          return cls;
        }
        order.push("before");
        @dec class Foo {}
        order.push("after");
        console.log(order.join(","));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("before,initializer,after\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("standard vs experimental mode switching", () => {
    test("JS files use standard decorators by default", async () => {
      // JS files always use standard decorators, even when
      // experimentalDecorators is set in tsconfig
      using dir = tempDir("es-dec-js", {
        "tsconfig.json": JSON.stringify({
          compilerOptions: { experimentalDecorators: true },
        }),
        "test.js": `
          function dec(cls, ctx) {
            console.log(ctx.kind);
            return cls;
          }
          @dec class Foo {}
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.js"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(filterStderr(rawStderr)).toBe("");
      expect(stdout).toBe("class\n");
      expect(exitCode).toBe(0);
    });

    test("TS files use experimental decorators when experimentalDecorators is set", async () => {
      using dir = tempDir("es-dec-ts-exp", {
        "tsconfig.json": JSON.stringify({
          compilerOptions: { experimentalDecorators: true },
        }),
        "test.ts": `
          function dec(target: any) {
            target.decorated = true;
          }
          @dec class Foo {}
          console.log((Foo as any).decorated);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(filterStderr(rawStderr)).toBe("");
      expect(stdout).toBe("true\n");
      expect(exitCode).toBe(0);
    });

    test("TS files use standard decorators when experimentalDecorators is not set", async () => {
      using dir = tempDir("es-dec-ts-std", {
        "tsconfig.json": JSON.stringify({
          compilerOptions: {},
        }),
        "test.ts": `
          function dec(cls: any, ctx: any) {
            console.log(ctx.kind, ctx.name);
            return cls;
          }
          @dec class Foo {}
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(filterStderr(rawStderr)).toBe("");
      expect(stdout).toBe("class Foo\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("extends clause", () => {
    test("decorator on class with extends", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(cls, ctx) {
          console.log(ctx.kind, ctx.name);
          return cls;
        }
        class Base {
          base = true;
        }
        @dec class Child extends Base {
          child = true;
        }
        const c = new Child();
        console.log(c.base, c.child);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("class Child\ntrue true\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("export default class", () => {
    test("export default class with method decorator", async () => {
      using dir = tempDir("es-dec-export-default", {
        "entry.js": `
          import Cls from "./mod.js";
          const c = new Cls();
          console.log(c.foo());
        `,
        "mod.js": `
          function dec(target, ctx) { return target; }
          export default class {
            @dec foo() { return 42; }
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.js"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(filterStderr(rawStderr)).toBe("");
      expect(stdout).toBe("42\n");
      expect(exitCode).toBe(0);
    });

    test("export default class with class decorator", async () => {
      using dir = tempDir("es-dec-export-default-cls", {
        "entry.js": `
          import Cls from "./mod.js";
          const c = new Cls();
          console.log(c.value);
        `,
        "mod.js": `
          function addValue(cls, ctx) {
            return class extends cls { value = "decorated"; };
          }
          @addValue export default class {}
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.js"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(filterStderr(rawStderr)).toBe("");
      expect(stdout).toBe("decorated\n");
      expect(exitCode).toBe(0);
    });

    test("export default named class with decorator", async () => {
      using dir = tempDir("es-dec-export-default-named", {
        "entry.js": `
          import Cls from "./mod.js";
          const c = new Cls();
          console.log(c.foo());
        `,
        "mod.js": `
          function dec(target, ctx) { return target; }
          export default class MyClass {
            @dec foo() { return "named"; }
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.js"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(filterStderr(rawStderr)).toBe("");
      expect(stdout).toBe("named\n");
      expect(exitCode).toBe(0);
    });

    test("export default anonymous decorated class expression", async () => {
      using dir = tempDir("es-dec-export-default-anon-expr", {
        "entry.js": `
          import Cls from "./mod.js";
          console.log(Cls.name);
          console.log(globalThis.decoratorContextName);
        `,
        "mod.js": `
          function dec(cls, ctx) { globalThis.decoratorContextName = ctx.name; }
          export default (@dec class {});
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.js"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(filterStderr(rawStderr)).toBe("");
      expect(stdout).toBe("default\ndefault\n");
      expect(exitCode).toBe(0);
    });

    test("export default anonymous class with class decorator", async () => {
      using dir = tempDir("es-dec-export-default-anon-dec", {
        "entry.js": `
          import Cls from "./mod.js";
          console.log(Cls.name);
          console.log(globalThis.decoratorContextName);
        `,
        "mod.js": `
          function dec(cls, ctx) { globalThis.decoratorContextName = ctx.name; }
          export default @dec class {}
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.js"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(filterStderr(rawStderr)).toBe("");
      expect(stdout).toBe("default\ndefault\n");
      expect(exitCode).toBe(0);
    });

    test("export default anonymous class expression with method decorator", async () => {
      using dir = tempDir("es-dec-export-default-anon-method", {
        "entry.js": `
          import Cls from "./mod.js";
          const c = new Cls();
          console.log(c.foo());
        `,
        "mod.js": `
          function dec(fn, ctx) { console.log("decorated", ctx.name); return fn; }
          export default (class {
            @dec foo() { return 42; }
          });
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.js"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(filterStderr(rawStderr)).toBe("");
      expect(stdout).toBe("decorated foo\n42\n");
      expect(exitCode).toBe(0);
    });

    test("export default anonymous class with auto-accessor and no decorators", async () => {
      using dir = tempDir("es-dec-export-default-anon-accessor", {
        "entry.js": `
          import Cls from "./mod.js";
          const c = new Cls();
          console.log(c.op);
          c.op = 42;
          console.log(c.op);
          const desc = Object.getOwnPropertyDescriptor(Cls.prototype, "op");
          console.log(typeof desc.get, typeof desc.set);
        `,
        "mod.js": `
          export default class {
            accessor op;
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.js"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(filterStderr(rawStderr)).toBe("");
      expect(stdout).toBe("undefined\n42\nfunction function\n");
      expect(exitCode).toBe(0);
    });

    test("export default anonymous TypeScript class with auto-accessor and no decorators", async () => {
      using dir = tempDir("es-dec-export-default-anon-accessor-ts", {
        "tsconfig.json": JSON.stringify({ compilerOptions: {} }),
        "entry.ts": `
          import Cls from "./mod.ts";
          const c = new Cls();
          c.op = "hello";
          console.log(c.op);
        `,
        "mod.ts": `
          export default class {
            accessor op: string | undefined;
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.ts"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(filterStderr(rawStderr)).toBe("");
      expect(stdout).toBe("hello\n");
      expect(exitCode).toBe(0);
    });

    test("Bun.build bundles export default anonymous class with auto-accessor", async () => {
      using dir = tempDir("es-dec-build-anon-accessor", {
        "build.js": `
          const result = await Bun.build({
            entrypoints: ["./mod.ts"],
            target: "bun",
            minify: true,
            sourcemap: "external",
            throw: false,
          });
          console.log(result.success);
        `,
        "mod.ts": `
          export default class {
            accessor op;
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build.js"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(filterStderr(rawStderr)).toBe("");
      expect(stdout).toBe("true\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("anonymous class expressions with reserved-word inferred names", () => {
    test("decorated anonymous class as value of a reserved-word object key", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(cls, ctx) { console.log("ctx.name:", ctx.name); }
        const obj = { default: (@dec class {}) };
        console.log(obj.default.name);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("ctx.name: default\ndefault\n");
      expect(exitCode).toBe(0);
    });

    test("Bun.Transpiler output for decorated anonymous default export reparses", () => {
      const transpiler = new Bun.Transpiler({ loader: "ts", target: "node", deadCodeElimination: true });
      const output = transpiler.transformSync("export default(@c class{})");
      // "default" is a keyword, so it must not be printed as the class binding name
      expect(output).not.toContain("class default");
      // the lowered output must still be valid syntax
      expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(output)).not.toThrow();
    });
  });

  describe("private member calls in lowered classes", () => {
    // When a class is lowered for standard decorators, `recv.#m(...)` becomes
    // `__privateGet(recv, _m).call(recv, ...)`. The receiver must be evaluated
    // exactly once: duplicating it re-runs side effects and makes the printed
    // output grow exponentially for chains like `o.#m().#m().#m()`.
    test("chained optional private calls do not explode the transpiled output size", () => {
      const chain = "?.Foo.#m()".repeat(20);
      const source = `class Foo {
        static #x = -0;
        static #m = function() {};
        @decorator() est() {
          return [o${chain}];
        }
      }`;

      const transpiler = new Bun.Transpiler({ loader: "js", target: "bun" });
      const output = transpiler.transformSync(source);

      // Exponential duplication produced ~47 MB for a 20-call chain; the
      // single-evaluation lowering stays in the kilobytes.
      expect(output.length).toBeLessThan(50_000);
      // The lowered output must still be valid syntax.
      expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(output)).not.toThrow();
    });

    test("double-call private chains in decorated static field initializers stay linear", () => {
      // Fuzzer-minimized variant: each `.#method()()` link re-lowers the whole
      // receiver, so duplicating it doubles the printed output per link
      // (~30 links allocated multiple GB before aborting).
      const chain = ".#method()()".repeat(20);
      const source = `class C {
        @decorator() static s = new C()${chain.slice(0, -2)};
        #method() { return 1e999; }
      }`;

      const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun", deadCodeElimination: true });
      const output = transpiler.transformSync(source);

      // Exponential duplication produced ~64 MB for 20 links; the
      // single-evaluation lowering stays in the kilobytes.
      expect(output.length).toBeLessThan(50_000);
      // The lowered output must still be valid syntax.
      expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(output)).not.toThrow();
    });

    test("calling the result of a private method call evaluates each link once", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return value; }
        let evals = 0;
        class C {
          @dec static s = new C().#method()().#method()().#method()();
          #method() { evals++; const self = this; return () => self; }
        }
        console.log(C.s instanceof C, evals);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("true 3\n");
      expect(exitCode).toBe(0);
    });

    test("receiver temps are scoped per invocation, not shared across reentrant calls", async () => {
      // A private getter runs user code inside __privateGet, between the
      // `_obj = recv` write and the `.call(_obj)` read. If the getter reenters
      // the same call site, a temp hoisted outside the method would be
      // clobbered and the outer call would see the inner receiver. Declaring
      // the temp inside the method body gives each invocation its own binding.
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return value; }
        let nextId = 0;
        let depth = 0;
        const order = [];
        class C {
          get #g() {
            if (depth++ === 0) make().run();
            const self = this;
            return function () { order.push(self.id + ":" + this.id); };
          }
          @dec run() { make().#g(); }
        }
        function make() { const c = new C(); c.id = ++nextId; return c; }
        make().run();
        console.log(JSON.stringify(order));
      `);
      expect(stderr).toBe("");
      // Each entry pairs the receiver seen at getter time with the receiver
      // the returned function was invoked on; they must always match.
      expect(stdout).toBe('["4:4","2:2"]\n');
      expect(exitCode).toBe(0);
    });

    test("private method call receiver is evaluated exactly once", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return value; }
        let receiverEvals = 0;
        class Counter {
          static #m = function (x) { return [this === Counter, x]; };
          @dec test() {
            return getCounter().#m(42);
          }
        }
        function getCounter() { receiverEvals++; return Counter; }
        console.log(JSON.stringify(new Counter().test()), receiverEvals);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("[true,42] 1\n");
      expect(exitCode).toBe(0);
    });

    test("chained optional private method calls return the right value", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return value; }
        class Chain {
          #tag;
          constructor(tag) { this.#tag = tag; }
          #next() { return { Chain: new Chain(this.#tag + 1) }; }
          @dec run(o) {
            return o?.Chain.#next()?.Chain.#next()?.Chain.#next()?.Chain.tag();
          }
          tag() { return this.#tag; }
        }
        console.log(new Chain(0).run({ Chain: new Chain(10) }));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("13\n");
      expect(exitCode).toBe(0);
    });

    test("private method calls through `this` and identifier receivers still work", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return value; }
        class Fast {
          #p(n) { return "p" + n; }
          @dec viaThis() { return this.#p(1); }
          @dec viaIdent(other) { return other.#p(2); }
        }
        const f = new Fast();
        console.log(f.viaThis(), f.viaIdent(new Fast()));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("p1 p2\n");
      expect(exitCode).toBe(0);
    });

    // Covers both temp placements in a decorated class expression: the method
    // body receiver gets a per-invocation `var` inside the method, while the
    // field initializer receiver is rewritten outside any function body, so
    // its temp is hoisted to the nearest statement list through the
    // class-expression path.
    test("decorated class expression evaluates chained private call receivers once", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return value; }
        let evals = 0;
        let initEvals = 0;
        function pick(x) { initEvals++; return x; }
        const C = class Foo {
          static #m = function (tag) { return { Foo, tag }; };
          #p(tag) { return "i" + tag; }
          @dec r = pick(this).#p("0");
          @dec test(o) {
            return o.effectful()?.Foo.#m("a")?.Foo.#m("b");
          }
        };
        const o = { Foo: C, effectful() { evals++; return { Foo: C }; } };
        const inst = new C();
        console.log(inst.r, inst.test(o).tag, evals, initEvals);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("i0 b 1 1\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("accessor with TypeScript annotations", () => {
    test("accessor with definite assignment assertion (!)", async () => {
      using dir = tempDir("es-dec-accessor-bang", {
        "tsconfig.json": JSON.stringify({ compilerOptions: {} }),
        "test.ts": `
          function dec(target: any, ctx: any) { return target; }
          class Foo {
            @dec accessor child!: string;
          }
          const f = new Foo();
          f.child = "hello";
          console.log(f.child);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(filterStderr(rawStderr)).toBe("");
      expect(stdout).toBe("hello\n");
      expect(exitCode).toBe(0);
    });

    test("accessor with optional marker (?)", async () => {
      using dir = tempDir("es-dec-accessor-optional", {
        "tsconfig.json": JSON.stringify({ compilerOptions: {} }),
        "test.ts": `
          function dec(target: any, ctx: any) { return target; }
          class Foo {
            @dec accessor child?: string;
          }
          const f = new Foo();
          console.log(f.child);
          f.child = "world";
          console.log(f.child);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(filterStderr(rawStderr)).toBe("");
      expect(stdout).toBe("undefined\nworld\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("auto-accessor in subclass", () => {
    test("subclass can override auto-accessor of same name (issue #29837)", async () => {
      // Each class's `accessor name = ...` desugars to its own private
      // storage slot per TC39 Decorators proposal. Reusing one WeakMap
      // for the base AND derived class causes super()'s __privateAdd
      // to populate the map and the subclass's own __privateAdd to
      // throw "Cannot add the same private member more than once".
      const { stdout, stderr, exitCode } = await runDecorator(`
        class A {
          accessor name = "A";
        }
        class B extends A {
          accessor name = "B";
          logName() {
            console.log(this.name);
            console.log(super.name);
          }
        }
        new B().logName();
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("B\nA\n");
      expect(exitCode).toBe(0);
    });

    test("multiple auto-accessors with same name across classes", async () => {
      // Exercises several same-named accessors to confirm each class
      // gets its own WeakMap binding regardless of property order.
      const { stdout, stderr, exitCode } = await runDecorator(`
        class X {
          accessor a = 1;
          accessor b = 2;
        }
        class Y extends X {
          accessor a = 10;
          accessor b = 20;
          check() {
            return [this.a, this.b, super.a, super.b];
          }
        }
        console.log(JSON.stringify(new Y().check()));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("[10,20,1,2]\n");
      expect(exitCode).toBe(0);
    });

    test("decorated auto-accessor in subclass with same name", async () => {
      // Same collision happens on the decorated path — verify the
      // decorator runs once per class and the values stay distinct.
      const { stdout, stderr, exitCode } = await runDecorator(`
        function tag(target, ctx) {
          return target;
        }
        class A {
          @tag accessor name = "A";
        }
        class B extends A {
          @tag accessor name = "B";
          both() {
            return this.name + "/" + super.name;
          }
        }
        console.log(new B().both());
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("B/A\n");
      expect(exitCode).toBe(0);
    });

    test("auto-accessor with string key that is not a valid identifier", async () => {
      // A non-identifier key like "foo-bar" can't be embedded (would be
      // unparseable), so it falls back to the synthetic storage name.
      const { stdout, stderr, exitCode } = await runDecorator(`
        class A {
          accessor "foo-bar" = "hi";
        }
        const a = new A();
        console.log(a["foo-bar"]);
        a["foo-bar"] = "bye";
        console.log(a["foo-bar"]);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("hi\nbye\n");
      expect(exitCode).toBe(0);
    });

    test("auto-accessor with non-ASCII string key", async () => {
      // Non-ASCII quoted keys are stored as UTF-16 in E.String. `isIdentifier`
      // alone would accept "café" (é is ID_Continue) and the format string
      // would then splice raw UTF-16 bytes into the symbol name, producing
      // invalid JS with embedded NULs. The additional `isUTF8()` guard
      // routes these to the safe fallback.
      const { stdout, stderr, exitCode } = await runDecorator(`
        class A {
          accessor "café" = "yes";
        }
        const a = new A();
        console.log(a["café"]);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("yes\n");
      expect(exitCode).toBe(0);
    });

    test("decorated private auto-accessor in subclass with same name", async () => {
      // Same collision as the public case, on the `is_private && k == 4`
      // branch of the decorated lowering path. Each class's `accessor #x`
      // must get its own WeakMap binding.
      const { stdout, stderr, exitCode } = await runDecorator(`
        function tag(target, ctx) {
          return target;
        }
        class A {
          @tag accessor #x = "A";
          getA() { return this.#x; }
        }
        class B extends A {
          @tag accessor #x = "B";
          getB() { return this.#x; }
        }
        const b = new B();
        console.log(b.getA(), b.getB());
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("A B\n");
      expect(exitCode).toBe(0);
    });

    test("digit-suffixed key does not collide with later counter value", async () => {
      // `accessor x1` and `accessor x` must not map to the same storage name
      // even when the counter digits line up. Needs >=11 accessors to trigger.
      const { stdout, stderr, exitCode } = await runDecorator(`
        class A { accessor x1 = "A"; }
        class F1 { accessor a = 0; accessor b = 0; accessor c = 0; }
        class F2 { accessor a = 0; accessor b = 0; accessor c = 0; }
        class F3 { accessor a = 0; accessor b = 0; accessor c = 0; }
        class K extends A {
          accessor x = "K";
          log() { console.log(this.x, super.x1); }
        }
        new K().log();
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("K A\n");
      expect(exitCode).toBe(0);
    });

    test("accessor storage does not collide with a same-named digit-suffixed private field", async () => {
      // Counter-first storage names (`_0_x`) can't equal a non-accessor private
      // binding (`_x_0`): identifiers can't start with a digit, so the two
      // namespaces are disjoint.
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(t, c) { return t; }
        class A {
          @dec accessor #x = 1;
          #x_0 = 2;
          read() { return [this.#x, this.#x_0]; }
        }
        console.log(JSON.stringify(new A().read()));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("[1,2]\n");
      expect(exitCode).toBe(0);
    });

    test("fallback storage does not collide with an #accessor_storage private field", async () => {
      // A non-identifier-keyed accessor uses the synthetic fallback, which is
      // also counter-first (`_0_accessor_storage`), so it can't equal a field
      // lowered to `_accessor_storage_0`.
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(t, c) { return t; }
        class A {
          @dec accessor "foo-bar" = 1;
          #accessor_storage_0 = 2;
          read() { return [this["foo-bar"], this.#accessor_storage_0]; }
        }
        console.log(JSON.stringify(new A().read()));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("[1,2]\n");
      expect(exitCode).toBe(0);
    });
  });
});
