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

    async function runDecoratorTS(code: string) {
      using dir = tempDir("es-dec-ts", {
        "tsconfig.json": JSON.stringify({ compilerOptions: {} }),
        "test.ts": code,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr: filterStderr(rawStderr), exitCode };
    }

    test("non-null assertion in decorator member expression", async () => {
      const { stdout, stderr, exitCode } = await runDecoratorTS(`
        const ns = {
          dec(cls: any, ctx: any) {
            console.log(ctx.kind, ctx.name);
            return cls;
          },
        };
        @ns!.dec
        class Foo {}
        @ns!.dec!
        class Bar {}
        console.log("done");
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("class Foo\nclass Bar\ndone\n");
      expect(exitCode).toBe(0);
    });

    test("type arguments in decorator member expression are stripped", async () => {
      const { stdout, stderr, exitCode } = await runDecoratorTS(`
        function dec<T>(cls: any, ctx: any) {
          console.log(ctx.kind, ctx.name);
          return cls;
        }
        const ns = {
          dec: function<T>(tag: string) {
            return function(cls: any, ctx: any) {
              console.log(tag, ctx.name);
              return cls;
            };
          },
        };
        @dec<string>
        class A {}
        @ns.dec<string>("hello")
        class B {}
        @ns<string>.dec<number>("bye")
        class C {}
        console.log("done");
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("class A\nhello B\nbye C\ndone\n");
      expect(exitCode).toBe(0);
    });

    test.each(["ts", "js"])("private name in decorator member expression (.%s)", async ext => {
      const run = ext === "ts" ? runDecoratorTS : runDecorator;
      const { stdout, stderr, exitCode } = await run(`
        class Outer {
          static #dec(cls, ctx) {
            console.log(ctx.kind, ctx.name);
            return cls;
          }
          static Inner = @Outer.#dec class Inner {};
        }
        new Outer.Inner();
        console.log("done");
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("class Inner\ndone\n");
      expect(exitCode).toBe(0);
    });

    test.each(["ts", "js"])("export before decorator (.%s)", async ext => {
      using dir = tempDir("es-dec-export", {
        "tsconfig.json": JSON.stringify({ compilerOptions: {} }),
        [`dep.${ext}`]: `
          function dec(cls, ctx) {
            console.log(ctx.kind, ctx.name);
            return cls;
          }
          export @dec class Foo {}
        `,
        [`test.${ext}`]: `
          import { Foo } from "./dep";
          console.log(typeof Foo);
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), `test.${ext}`],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(filterStderr(rawStderr)).toBe("");
      expect(stdout).toBe("class Foo\nfunction\n");
      expect(exitCode).toBe(0);
    });

    test("non-null assertion in decorator is rejected in JavaScript", async () => {
      const { stderr, exitCode } = await runDecorator(`
        const ns = { dec(cls, ctx) { return cls; } };
        @ns!.dec class Foo {}
      `);
      expect(stderr).toContain("error: Unexpected !");
      expect(exitCode).not.toBe(0);
    });

    test("optional chaining in decorator is rejected with a hint", async () => {
      const { stderr, exitCode } = await runDecoratorTS(`
        @x?.y class Foo {}
      `);
      expect(stderr).toContain("Optional chaining is not allowed in decorator expressions");
      expect(stderr).toContain("wrap the expression in parentheses");
      expect(exitCode).not.toBe(0);
    });

    test("property access after call in decorator is rejected", async () => {
      const { stderr, exitCode } = await runDecoratorTS(`
        @x().y class Foo {}
      `);
      expect(stderr).toContain("wrap the expression in parentheses");
      expect(exitCode).not.toBe(0);
    });

    test("decorators on both sides of export are rejected", async () => {
      const { stderr, exitCode } = await runDecoratorTS(`
        @x export @y class Foo {}
      `);
      expect(stderr).toContain('Expected "class" but found "@"');
      expect(exitCode).not.toBe(0);
    });

    test("repeated export around a decorator is rejected", async () => {
      const { stderr, exitCode } = await runDecoratorTS(`
        export @dec export class Foo {}
      `);
      expect(stderr).toContain('Expected "class" but found "export"');
      expect(exitCode).not.toBe(0);
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

  // Once a class has a decorated member, its private methods, getters and
  // setters are moved out of the class body into plain function expressions
  // (`_m_fn = function () { ... }`, or the function passed to
  // __decorateElement). `super.x` is a syntax error in a plain function, so
  // the lowering rewrites it to __superGet / __superSet / __superWrapper
  // calls that look the property up on the prototype of the original class
  // (captured by a static block at the top of the class body), with the
  // method's `this` as receiver.
  describe.concurrent("super property access in lowered private methods", () => {
    test("undecorated private method in a class with a decorated member", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return value; }
        class Base { greet() { return "hi"; } }
        class C extends Base {
          @dec m() {}
          #im() { return super.greet(); }
          callI() { return this.#im(); }
        }
        console.log(new C().callI());
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("hi\n");
      expect(exitCode).toBe(0);
    });

    test("decorated private method, getter, setter and static method", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return value; }
        function wrap(value, ctx) { return function (...args) { return "wrapped:" + value.call(this, ...args); }; }
        class Base {
          greet() { return "hi:" + this.id; }
          get g() { return "g:" + this.id; }
          set g(v) { this.last = "set:" + v; }
          static sgreet() { return "shi:" + this.name; }
        }
        class C extends Base {
          id = "c";
          @wrap #im() { return super.greet(); }
          @dec get #acc() { return super.g; }
          @dec set #acc(v) { super.g = v; }
          @dec static #sm() { return super.sgreet(); }
          run() { this.#acc = 1; return [this.#im(), this.#acc, this.last, C.#sm()]; }
        }
        console.log(JSON.stringify(new C().run()));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe('["wrapped:hi:c","g:c","set:1","shi:C"]\n');
      expect(exitCode).toBe(0);
    });

    test("class without an extends clause looks up Object.prototype and Function.prototype", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return value; }
        class C {
          @dec m() {}
          #im() { return [super.hasOwnProperty === Object.prototype.hasOwnProperty, super.constructor === Object]; }
          static #sm() { return [super.call === Function.prototype.call, super.constructor === Function]; }
          run() { return [...this.#im(), ...C.#sm()]; }
        }
        console.log(JSON.stringify(new C().run()));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("[true,true,true,true]\n");
      expect(exitCode).toBe(0);
    });

    // The same members are run twice: natively (class without decorators)
    // and lowered (one decorated member added). Both must print the same
    // thing, and the literal below documents what that is.
    test("every access form behaves like the native class", async () => {
      const members = `
        #m(param = super.f("param")) {
          const out = { param };
          let keyEvals = 0;
          const k = () => (keyEvals++, key);
          super.x = 1;
          out.get = [super.x, super["x"], super[key] === undefined];
          out.assignValue = (super[key] = 2);
          out.getComputed = super[key];
          out.call = super.f(1, ...[2, 3]);
          out.callComputed = super[(keyEvals++, "f")](4);
          out.optionalCall = [super.f?.(5), super.nothing?.(), super.f(6)?.length];
          out.compound = [(super.x += 10), super.x, (super[k()] **= 3), super.y, keyEvals];
          this._y = null;
          out.logical = [(super.x ??= "skipped"), (super.y ??= "filled"), (super.y &&= "and"), (super.x ||= "skipped"), super.x, super.y];
          super[key] = 5;
          out.update = [super.x++, ++super.x, super[key]--, --super[key], super.x, super.y];
          [super.x, super[key]] = [100, 200];
          out.arrayTarget = [super.x, super.y];
          ({ a: super.x, b: super.y = "dflt", ...super.rest } = { a: 7, b: undefined, c: 1, d: 2 });
          out.objectTarget = [super.x, super.y, this.rest];
          [super.x = "arrDflt", ...super.spreadRest] = [undefined, 1, 2];
          out.patternDefaults = [super.x, this.spreadRest];
          for (super.x of [31, 32]) out.forOf = super.x;
          for (super[key] in { k1: 0 }) out.forIn = super.y;
          super.defined = "own";
          out.definesOnReceiver = [Object.hasOwn(this, "defined"), "defined" in Base.prototype];
          try { super.readonly = 1; out.readonly = "assigned"; } catch (e) { out.readonly = e.constructor.name; }
          out.tagged = super.tag\`a\${1}b\${2}\`;
          out.newed = new super.constructor.Made("n").made;
          out.arrows = [(() => super.f("arrow"))(), ((q = super.x) => q)()];
          const literal = { value: super.x, method() { return super.toString === Object.prototype.toString; } };
          out.objectLiteral = [literal.value, literal.method()];
          class Nested extends super.constructor { own() { return super.f("nested"); } }
          out.nestedClass = new Nested().own();
          function plain() { return { m() { return super.constructor === Object; } }.m(); }
          out.plainFunction = plain();
          out.typeofGet = typeof super.f;
          out.privateOperands = [super[this.#keyName], super.f(this.#v, this.#p())];
          let deleteKeyEvals = 0;
          try {
            out.deleteSuper = delete super[(deleteKeyEvals++, "probe")];
          } catch (e) {
            out.deleteSuper = [e.constructor.name, deleteKeyEvals, probeReads];
          }
          return out;
        }
        #keyName = "readonly";
        #v = 42;
        #p() { return "p"; }
        get #acc() { return super.x; }
        set #acc(v) { super.x = v; }
        async #asyncM() { return await super.f("async"); }
        *#gen() { yield super.f("gen"); }
        static #s() {
          super.sx = "s";
          super.sx += "!";
          return [super.sx, super.sf("a"), super.sf?.("b"), this._sx];
        }
        run() { self = this; this.#acc = "viaSetter"; return { m: this.#m(), acc: this.#acc }; }
        runAsync() { self = this; return this.#asyncM(); }
        runGen() { self = this; return [...this.#gen()]; }
        static runStatic() { selfClass = this; return this.#s(); }
      `;
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return value; }
        let self, selfClass;
        let probeReads = 0;
        class Base {
          get x() { return this._x; }
          set x(v) { this._x = v; }
          get y() { return this._y; }
          set y(v) { this._y = v; }
          get readonly() { return "ro"; }
          get probe() { probeReads++; }
          f(...args) { return [this === self, ...args]; }
          tag(strings, ...subs) { return [strings.raw.join("|"), ...subs]; }
          static get sx() { return this._sx; }
          static set sx(v) { this._sx = v; }
          static sf(a) { return [this === selfClass, a]; }
          static Made = class { constructor(a) { this.made = a; } };
        }
        const key = "y";
        class Native extends Base {${members}}
        class Lowered extends Base {
          @dec decorated() {}
          ${members}
        }
        for (const C of [Native, Lowered]) {
          const c = new C();
          console.log(JSON.stringify({ sync: c.run(), async: await c.runAsync(), gen: c.runGen(), static: C.runStatic() }));
        }
      `);
      expect(stderr).toBe("");
      const [native, lowered] = stdout.trim().split("\n");
      expect(lowered).toBe(native);
      expect(JSON.parse(lowered)).toEqual({
        sync: {
          m: {
            param: [true, "param"],
            get: [1, 1, true],
            assignValue: 2,
            getComputed: 2,
            call: [true, 1, 2, 3],
            callComputed: [true, 4],
            optionalCall: [[true, 5], null, 2],
            compound: [11, 11, 8, 8, 2],
            logical: [11, "filled", "and", 11, 11, "and"],
            update: [11, 13, 5, 3, 13, 3],
            arrayTarget: [100, 200],
            objectTarget: [7, "dflt", { c: 1, d: 2 }],
            patternDefaults: ["arrDflt", [1, 2]],
            forOf: 32,
            forIn: "k1",
            definesOnReceiver: [true, false],
            readonly: "TypeError",
            tagged: ["a|b|", 1, 2],
            newed: "n",
            arrows: [[true, "arrow"], 32],
            objectLiteral: [32, true],
            nestedClass: [false, "nested"],
            plainFunction: true,
            typeofGet: "function",
            privateOperands: ["ro", [true, 42, "p"]],
            // The key is evaluated, the inherited getter is not, and the delete throws.
            deleteSuper: ["ReferenceError", 1, 0],
          },
          acc: 32,
        },
        async: [true, "async"],
        gen: [[true, "gen"]],
        static: ["s!", [true, "a"], [true, "b"], "s!"],
      });
      expect(exitCode).toBe(0);
    });

    test("a super tag function is called with the method's this", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return value; }
        class Base { tag(strings) { return [this, strings[0]]; } }
        class C extends Base {
          @dec m() {}
          #im() { return super.tag\`t\`; }
          run() { const [receiver, text] = this.#im(); return [receiver === this, text]; }
        }
        console.log(JSON.stringify(new C().run()));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe('[true,"t"]\n');
      expect(exitCode).toBe(0);
    });

    test("class declaration replaced by a class decorator keeps the original parent", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return value; }
        class Base { greet() { return "base"; } }
        function replace(cls, ctx) { return class extends cls { greet() { return "replacement:" + super.greet(); } }; }
        @replace
        class C extends Base {
          @dec decorated() {}
          greet() { return "c:" + super.greet(); }
          #im() { return super.greet(); }
          run() { return [this.#im(), this.greet()]; }
        }
        console.log(JSON.stringify(new C().run()));
      `);
      expect(stderr).toBe("");
      // #im's super is Base.greet, not the original C.greet that a lookup
      // through the replacement's prototype chain would find.
      expect(stdout).toBe('["base","replacement:c:base"]\n');
      expect(exitCode).toBe(0);
    });

    test("class expression replaced by a class decorator keeps the original parent", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return value; }
        class Base { greet() { return "base"; } }
        function replace(cls, ctx) { return class extends cls { greet() { return "replacement:" + super.greet(); } }; }
        const C = @replace class extends Base {
          @dec decorated() {}
          greet() { return "c:" + super.greet(); }
          #im() { return super.greet(); }
          run() { return [this.#im(), this.greet()]; }
        };
        console.log(JSON.stringify(new C().run()));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe('["base","replacement:c:base"]\n');
      expect(exitCode).toBe(0);
    });

    test("static private method using super can run while the class body is still being evaluated", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return value; }
        class Base { static sgreet() { return "shi:" + this.name; } }
        class C extends Base {
          @dec m() {}
          static #make() { return super.sgreet(); }
          static helper() { return this.#make(); }
          static early = this.helper();
        }
        console.log(C.early);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("shi:C\n");
      expect(exitCode).toBe(0);
    });

    test("each evaluation of a class inside a function gets its own parent", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return value; }
        function make(base) {
          class C extends base {
            @dec m() {}
            #im() { return super.greet(); }
            run() { return this.#im(); }
          }
          return new C();
        }
        class A { greet() { return "a"; } }
        class B { greet() { return "b"; } }
        const a = make(A);
        const b = make(B);
        console.log(a.run(), b.run());
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("a b\n");
      expect(exitCode).toBe(0);
    });

    test("a class nested in a lowered method body keeps its own super", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return value; }
        class InnerBase { greet() { return "inner"; } static sgreet() { return "static inner"; } }
        class OuterBase { greet() { return "outer"; } innerBase() { return InnerBase; } }
        class Outer extends OuterBase {
          @dec m() {}
          #im() {
            // The extends clause is evaluated in the outer method, so its
            // super is OuterBase's; everything inside the body is Inner's own.
            class Inner extends super.innerBase() {
              static { this.fromBlock = super.sgreet(); }
              field = super.greet();
              method() { return super.greet(); }
            }
            const inner = new Inner();
            return [super.greet(), (() => super.greet())(), Inner.fromBlock, inner.field, inner.method()];
          }
          run() { return this.#im(); }
        }
        console.log(JSON.stringify(new Outer().run()));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe('["outer","outer","static inner","inner","inner"]\n');
      expect(exitCode).toBe(0);
    });

    test("the class is only captured when a lowered method uses super", () => {
      const transpiler = new Bun.Transpiler({ loader: "js" });
      const withSuper = transpiler.transformSync(`
        class C extends Base {
          @dec m() {}
          #im() { return super.greet(); }
          static #sm() { return super.sgreet(); }
        }
      `);
      // The runtime helpers are imported from bun:wrap under a suffixed alias.
      expect(withSuper).toMatch(/__superGet\w*\(_home\.prototype, this, "greet"\)\.call\(this\)/);
      expect(withSuper).toMatch(/__superGet\w*\(_home, this, "sgreet"\)\.call\(this\)/);
      expect(withSuper).toContain("_home = this;");
      expect(withSuper).not.toContain("super.");

      const withoutSuper = transpiler.transformSync(`
        class C extends Base {
          @dec m() {}
          #im() { return this.greet(); }
          inBody() { return super.greet(); }
        }
      `);
      expect(withoutSuper).not.toContain("_home");
      expect(withoutSuper).not.toContain("__superGet");
      // Methods that stay in the class body keep their native super.
      expect(withoutSuper).toContain("return super.greet();");
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
});
