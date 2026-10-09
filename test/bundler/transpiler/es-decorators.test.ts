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

async function runIn(cwd: string, args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
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

  // `bun run` has no symbol renamer: the lowering's `var _init`, `var _dec` and the
  // WeakMap behind each accessor or `#private` are printed under the name the
  // parser gave them, so that name has to be unique in the file.
  describe("lowering temporaries", () => {
    test.concurrent("an accessor decorator's init does not leak into another class (#40761)", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function Field(_, _c) {}
        function AccessorDecorator(_, c) {
          return { init: () => c.name, get: () => c.name };
        }
        class Entity { @Field id; }
        class Action { @AccessorDecorator accessor success; }
        console.log(new Entity().id);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("undefined\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("field initializers run for their own class (#28316, #28010)", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const log = [];
        const d = name => (_, ctx) => v => (log.push(name + ":" + ctx.name + "=" + v), v);
        class Parent { @d("Parent") foo = "p1"; @d("Parent") shared = "p2"; }
        class Child extends Parent { @d("Child") foo = "c1"; @d("Child") own = "c2"; }
        new Child();
        class Test1 { @d("Test1") field1 = "t1"; }
        class Test2 { @d("Test2") field2 = "t2"; }
        new Test1();
        console.log(log.join(" "));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("Parent:foo=p1 Parent:shared=p2 Child:foo=c1 Child:own=c2 Test1:field1=t1\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("two classes with an accessor of the same name keep separate storage", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(_, _c) {}
        class A { @dec accessor x = "a"; }
        class B { @dec accessor x = "b"; }
        const a = new A();
        const b = new B();
        console.log(a.x, b.x);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("a b\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("a subclass can redeclare an accessor of its base class (#29837)", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        class A { accessor name = "A"; }
        class B extends A {
          accessor name = "B";
          logName() { console.log(this.name, super.name); }
        }
        new B().logName();
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("B A\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("private members of the same name in two classes, and next to an accessor", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(_, _c) {}
        class A {
          accessor x = "A.x";
          @dec #x = "A.#x";
          #m() { return "A.#m"; }
          read() { return [this.x, this.#x, this.#m()].join(" "); }
        }
        class B {
          @dec #m() { return "B.#m"; }
          read() { return this.#m(); }
        }
        console.log(new A().read(), new B().read());
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("A.x A.#x A.#m B.#m\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("two decorated classes inside one function keep separate initializers", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(_, ctx) {
          ctx.addInitializer(function () { this.tag = ctx.name; });
        }
        function make() {
          class A { @dec a() {} }
          class B { @dec b() {} }
          return [new A().tag, new B().tag];
        }
        console.log(make().join(" "));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("a b\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("class expressions in sibling blocks keep separate storage", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(_, _c) {}
        let A, B;
        { A = class { @dec accessor x = "a"; }; }
        { B = class { @dec accessor x = "b"; }; }
        console.log(new A().x, new B().x);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("a b\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("user bindings named like a temporary are left alone", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const _init = "init", _dec = "dec", _obj = "obj";
        let _x = "x";
        function dec(_, _c) {}
        class A {
          @dec accessor x = 1;
          @dec #m() { return "m"; }
          call(o) { return o.get().#m(); }
        }
        const a = new A();
        console.log(_init, _dec, _obj, _x, a.x, a.call({ get: () => a }));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("init dec obj x 1 m\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("an accessor whose key is not an identifier gets a valid storage name", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(_, _c) {}
        class A { @dec accessor "x y" = 1; accessor "a-b" = 2; @dec accessor 3 = 3; }
        const a = new A();
        console.log(a["x y"], a["a-b"], a[3]);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("1 2 3\n");
      expect(exitCode).toBe(0);
    });
  });

  // A lowered class keeps its members where they are written. Decorator lists
  // are evaluated in the key of their member, a leading static block applies
  // them, and what runs between two instance fields rides in the next one.
  describe("members stay where they are written", () => {
    test.concurrent("undecorated fields initialize in source order next to decorated fields", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const dec = (v, ctx) => {}; const log = (s) => (console.log("init", s), s);
        class Foo { @dec a = log("a"); b = log(this.a === "a" ? "b (a set)" : "b (a NOT set)"); @dec c = log("c"); }
        new Foo();
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("init a\ninit b (a set)\ninit c\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("decorated fields are defined, not assigned", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const dec = (v, ctx) => {};
        class Base { set a(v) { console.log("BASE SETTER", v) } }
        class Bar extends Base { @dec a = 1 }
        console.log(JSON.stringify(Object.getOwnPropertyDescriptor(new Bar(), "a")));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe('{"value":1,"writable":true,"enumerable":true,"configurable":true}\n');
      expect(exitCode).toBe(0);
    });

    test.concurrent("static fields and static blocks keep their order next to decorated members", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const dec = (v, ctx) => {};
        class S { @dec static x = console.log(1); static { console.log(2) } static y = console.log(3) }
        class T { static { console.log(1) } static x = console.log(2); @dec m() {} }
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("1\n2\n3\n1\n2\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent(
      "undecorated private members stay native, and every initializer reaches a lowered one",
      async () => {
        const { stdout, stderr, exitCode } = await runDecorator(`
        function d(t, k) {}
        class D { static #p = 5; static a = D.#p; static b = this.#p; #q = 6; d = this.#q; e() { return D.#p + this.#q } @d m() {} }
        class E {
          @d #low = 7;
          @d static #slow = 8;
          a = this.#low;
          b = () => this.#low;
          static c = E.#slow;
          static { E.d = this.#slow; }
          [(o => o.#low, "f")] = #low in this;
          static read(o) { function inner() { return o.#low } class N { static v = o.#low } return [inner(), N.v, (({ x = o.#low }) => x)({})] }
        }
        const e = new E();
        console.log(D.a, D.b, new D().d, new D().e(), e.a, e.b(), E.c, E.d, e.f, E.read(e));
      `);
        expect(stderr).toBe("");
        expect(stdout).toBe("5 5 6 11 7 7 8 8 true [ 7, 7, 7 ]\n");
        expect(exitCode).toBe(0);
      },
    );

    test.concurrent("new.target stays undefined in field initializers and static blocks", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const dec = (v, ctx) => {};
        class C {
          @dec m() {}
          static a = new.target;
          @dec b = new.target;
          c = () => new.target;
          d = function () { return new.target; };
          static { C.sb = new.target; }
        }
        class D extends C { e = new.target; }
        const c = new C(), d = new D(), fn = d.d;
        console.log(C.a, c.b, c.c(), C.sb, d.b, d.e, new fn() === fn);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("undefined undefined undefined undefined undefined undefined true\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("super resolves from the class as written when a class decorator replaces it", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const dec = (v, ctx) => {};
        const wrap = (C) => class extends C { static sg() { return "wrapper" } greet() { return "wrapper" } };
        class B { greet() { return "B" } static sg() { return "B" } }
        @wrap class C extends B {
          @dec x = super.greet();
          greet() { return "C" }
          static sg() { return "C" }
          #m() { return super.greet() }
          static #s() { return super.sg() }
          call() { return [this.x, this.#m(), C.#s()] }
          @dec static y = super.sg();
          static { C.blk = super.sg(); }
        }
        console.log(new C().call(), C.y, C.blk, Object.getPrototypeOf(C) !== B);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe('[ "B", "B", "B" ] B B true\n');
      expect(exitCode).toBe(0);
    });

    test.concurrent("super.m?.() in a static initializer keeps short-circuiting the rest of its chain", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const dec = (v, ctx) => {};
        class B { static get maybe() { return undefined } static sg() { return "B" } }
        class C extends B {
          @dec m() {}
          @dec static z = super.maybe?.().value;
          static w = super.sg?.().length;
          static { C.blk = super.maybe?.()?.x ?? "none"; }
        }
        console.log(C.z, C.w, C.blk);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("undefined 1 none\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("the inner name of a named class expression resolves in private methods", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const dec = (v, ctx) => {};
        const A = class Foo {
          @dec a = 1;
          #m() { return Foo }
          @dec #n() { return Foo }
          static #s() { return [Foo, this] }
          call() { return [this.#m(), this.#n()] }
          static scall() { return Foo.#s() }
        };
        console.log(new A().call().every(c => c === A), A.scall()[0] === A, A.scall()[1] === A);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("true true true\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("decorator lists are evaluated where their member is written", async () => {
      // In the key of the member, so: in order with computed keys, with the
      // outer \`this\`, \`await\` and \`arguments\`, inside the private scope of
      // the class, and before the class binding is initialized. A decorated
      // \`#private\` member has no key of its own and uses a neighbor's.
      const { stdout, stderr, exitCode } = await runDecorator(`
        const log = [];
        const K = (n) => (log.push("k:" + n), n);
        const D = (n, ...rest) => (log.push("d:" + n), () => {});
        async function outer() {
          class A {
            @D(1) #first = 0;
            [K("a")] = 0;
            @D(2, this.tag, arguments[0]) b() {}
            static [K("c")]() {}
            @D(3) #p = 0;
            @D(4) static #q() {}
            @D(await 5) accessor e = 0;
            [K("f")]() {}
            @D(6, (o) => o.#p, () => A) #last = 0;
            constructor() {}
            static { log.push("static") }
          }
          return log.join(" ");
        }
        console.log(await outer.call({ tag: "t" }, "arg"));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("d:1 k:a d:2 k:c d:3 d:4 d:5 k:f d:6 static\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("a decorator expression sees the outer this, its own class only after it is defined", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const fns = [];
        const capture = (fn) => { fns.push(fn); try { fn(); fns.push("no TDZ") } catch (e) { fns.push(e.constructor.name) } return () => {} };
        function outer() {
          class A { @capture(() => [this.tag, A]) m() {} @capture(() => [this.tag, A]) #p() {} }
          return A;
        }
        const A = outer.call({ tag: "t" });
        console.log(fns[1], fns[3], fns[0]()[0], fns[0]()[1] === A, fns[2]()[0], fns[2]()[1] === A);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("ReferenceError ReferenceError t true t true\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent(
      "class decorators run before static fields, extra initializers right after their field",
      async () => {
        const { stdout, stderr, exitCode } = await runDecorator(`
        const log = [];
        const cls = (C, ctx) => { log.push("class:" + Object.hasOwn(C, "s")); ctx.addInitializer(function () { log.push("class extra:" + this.s) }) };
        const field = (v, ctx) => { ctx.addInitializer(function () { log.push(ctx.name + " extra:" + Object.keys(this)) }) };
        const method = field;
        @cls class A {
          static s = (log.push("s"), 1);
          @field a = (log.push("a"), 1);
          accessor b = (log.push("b"), 2);
          @field c = (log.push("c"), 3);
          @method m() {}
        }
        log.push("new");
        new A();
        console.log(log.join(" | "));
      `);
        expect(stderr).toBe("");
        expect(stdout).toBe("class:false | s | class extra:1 | new | m extra: | a | a extra:a | b | c | c extra:a,c\n");
        expect(exitCode).toBe(0);
      },
    );

    test.concurrent("an anonymous class expression keeps the name its context gives it", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const dec = (v, ctx) => {};
        const A = class { @dec x = 1 };
        const B = @dec class { accessor y = 2 };
        const o = { C: class { @dec static #z = 3 } };
        console.log(A.name, B.name, o.C.name, JSON.stringify((class { @dec m() {} }).name));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe('A B C ""\n');
      expect(exitCode).toBe(0);
    });

    test.concurrent("decorator lists no key of the class can hold are evaluated before it", async () => {
      // Only \`#private\` members and a constructor: no computed key to borrow.
      const { stdout, stderr, exitCode } = await runDecorator(`
        const log = [];
        const D = (n, d) => (log.push("d:" + n), d ?? ((v, ctx) => { log.push("apply:" + ctx.name) }));
        class A { @D(1) #a = 1; @D(2) static #b() {} constructor() { log.push("ctor:" + this.#a) } }
        new A();
        function outer() { return class { @D(3, this.dec) #x = 1; @D("3b", arguments[0]) #w = 2; constructor() { log.push("x:" + this.#x + this.#w) } } }
        new (outer.call({ dec: (v, ctx) => { log.push("this.dec:" + ctx.name) } }, (v, ctx) => { log.push("arguments[0]:" + ctx.name) }))();
        const late = Promise.resolve((v, ctx) => { log.push("awaited:" + ctx.name) });
        const E = class { @D(4, await late) #y = 1 };
        function* gen() { return class { @D(5, yield) #z = 1 }; }
        const it = gen(); it.next(); it.next((v, ctx) => { log.push("yielded:" + ctx.name) });
        console.log(log.join(" "), JSON.stringify(E.name));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe(
        'd:1 d:2 apply:#b apply:#a ctor:1 d:3 d:3b this.dec:#x arguments[0]:#w x:12 d:4 awaited:#y d:5 yielded:#z "E"\n',
      );
      expect(exitCode).toBe(0);
    });

    test.concurrent("a field that carries the effects of its neighbors keeps naming its function", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const dec = (v, ctx) => {};
        class A { @dec m() {} first = () => {}; accessor a = 1; afterAccessor = class {}; plain = function () {}; @dec d = 1; afterField = () => {}; "q r" = () => {}; }
        class B { accessor a = 1; onlyAccessors = () => {}; }
        const a = new A();
        console.log(JSON.stringify([a.first.name, a.afterAccessor.name, a.plain.name, a.afterField.name, a["q r"].name, new B().onlyAccessors.name]));
        const k = "dyn", sym = Symbol("desc");
        class C {
          accessor a = 1; [k] = function () {};
          accessor b = 2; 123 = class {};
          accessor c = 3; [sym] = () => {};
          accessor d = 4; #p = () => {}; privateName() { return this.#p.name }
          accessor f = 6; #own = class { static name = "own" }; ownName() { return this.#own.name }
          accessor e = 5; ["__proto__"] = function () {};
        }
        const c = new C();
        console.log(JSON.stringify([c[k].name, c[123].name, c[sym].name, c.privateName(), c.ownName(), c["__proto__"].name, Object.getPrototypeOf(c) === C.prototype]));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe(
        '["first","afterAccessor","plain","afterField","q r","onlyAccessors"]\n["dyn","123","[desc]","#p","own","__proto__",true]\n',
      );
      expect(exitCode).toBe(0);
    });

    test.concurrent(
      "a class with no key for its decorator lists: private names, extends and the inner name",
      async () => {
        const { stdout, stderr, exitCode } = await runDecorator(`
        const dec = (v) => v, order = [];
        let inB, inA;
        class B { @(inB = (o) => #m in o, dec) #m() { return 1 } }
        class A { #y = 1; @(inA = (o) => #y in o, dec) #m() {} static {} }
        class E extends (order.push("extends"), Object) { @(order.push("dec m"), dec) #m() {} @(order.push("dec x"), dec) #x = 1; }
        const later = [];
        const lazy = (f) => (later.push(f), dec);
        const X = class Inner extends Object { @lazy(() => Inner) #p; constructor() { super() } };
        console.log(inB(new B()), inA(new A()), inA({}), order.join(","), later[0]() === X);
        let x = 5, seen;
        const o = { x: class { @dec #p = 1; static { seen = x } } };
        function g() { var h = class { @dec #p() {} static { this.self = () => h } }; const was = h; h = null; return [was.name, was.self()] }
        console.log(o.x.name, seen, JSON.stringify(g()));
        const Named = class Self { @lazy(() => Self) #q() {} };
        class Symbol {}
        class Shadow { @dec #s = 1 }
        console.log(later[1]() === Named, JSON.stringify([B, A, Shadow].map(C => Object.getOwnPropertyNames(C))));
      `);
        expect(stderr).toBe("");
        expect(stdout).toBe(
          'true true false extends,dec m,dec x true\nx 5 ["h",null]\ntrue [["length","name","prototype"],["length","name","prototype"],["length","name","prototype"]]\n',
        );
        expect(exitCode).toBe(0);
      },
    );

    test.concurrent("a class decorator on a class whose context name is not an identifier", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const dec = (v, ctx) => { console.log(ctx.kind, ctx.name) };
        const o = { "a-b c": @dec class {} };
        class Q { static "x y" = @dec class { @dec m() {} } }
        console.log(o["a-b c"].name, Q["x y"].name);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("class a-b c\nmethod m\nclass x y\na-b c x y\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("an exported decorated class next to a lowered top-level using", async () => {
      using dir = tempDir("es-dec-using", {
        "entry.js": `
          const dec = (v, ctx) => {};
          using res = { [Symbol.dispose]() { console.log("disposed") } };
          export @dec class A { @dec m() { return 1 } }
          export class B extends A { @dec accessor x = 2 }
          console.log(new A().m(), new B().x);
        `,
      });
      const build = await runIn(String(dir), ["build", "--target=browser", "entry.js", "--outfile=out.js"]);
      expect({ stderr: filterStderr(build.stderr), exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const { stdout, stderr, exitCode } = await runIn(String(dir), ["out.js"]);
      expect(filterStderr(stderr)).toBe("");
      expect(stdout).toBe("1 2\ndisposed\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("a class decorator's initializers run once the class is bound to its name", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const log = [];
        function register(v, ctx) { ctx.addInitializer(function () { log.push(A === this, typeof A.create, A.ready) }) }
        @register class A { static create() { return new A() } static ready = (log.push("static field"), true) }
        console.log(log.join(" "));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("static field true function true\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("a TypeScript parameter property that holds the decorator lists keeps its name", async () => {
      // The field of \`constructor(public x)\` is the only member with a key.
      using dir = tempDir("es-dec-param-prop-key", {
        "tsconfig.json": "{}",
        "test.ts": `
          const dec = (v: any, ctx: any) => {};
          const seen: unknown[] = [];
          class C { @dec #a = 1; constructor(public x: number) { seen.push(this.#a); } }
          const c = new C(5);
          function scope() {
            const y = "outer";
            class D { @dec #b = 2; constructor(public y: number) { seen.push(this.#b); } }
            return new D(6);
          }
          const d = scope();
          console.log(JSON.stringify([c.x, Object.keys(c), d.y, Object.keys(d), seen]));
        `,
      });
      const { stdout, stderr, exitCode } = await runIn(String(dir), ["test.ts"]);
      expect(filterStderr(stderr)).toBe("");
      expect(stdout).toBe('[5,["x"],6,["y"],[1,2]]\n');
      expect(exitCode).toBe(0);
    });

    test.concurrent("a decorated private name in the head of a loop or in a catch binding", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const dec = (v, ctx) => {};
        class A {
          @dec #x = 1;
          forOf(a) { const out = []; for (const { v = this.#x } of a) out.push(v); return out; }
          forIn(o) { const out = []; for (const { nope = this.#x } in o) out.push(nope); return out; }
          caught() { try { throw {}; } catch ({ v = this.#x }) { return v; } }
        }
        const a = new A();
        console.log(JSON.stringify([a.forOf([{}, { v: 2 }]), a.forIn({ k: 0 }), a.caught()]));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("[[1,2],[1],1]\n");
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

  describe("class statement placement", () => {
    // The runtime hoists a class statement to the top of the module when the
    // class has no side effects. A static auto-accessor initializer is a side
    // effect like a static field initializer, so the class must stay where it
    // was written or the initializer runs before the bindings it reads exist.
    test("static accessor initializer keeps the class in place", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        let order = [];
        order.push("top");
        function sideEffect(name, value) {
          order.push(name);
          return value;
        }
        class C {
          accessor m = sideEffect("m", 1);
          static accessor s = sideEffect("s", 2);
        }
        order.push("after class");
        const c = new C();
        console.log(order.join(","), C.s, c.m);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("top,s,after class,m 2 1\n");
      expect(exitCode).toBe(0);
    });
  });
});

// One fixture holds a matrix of decorated members and prints one JSON object;
// each cell is then its own test. It runs as .js and .ts, and through `bun build`.

const kinds = ["field", "method", "getter", "setter", "accessor"] as const;
const placements = ["instance", "static"] as const;
const visibilities = ["public", "private"] as const;
type Kind = (typeof kinds)[number];
type Placement = (typeof placements)[number];
type Visibility = (typeof visibilities)[number];

type Cell = {
  kind: Kind;
  placement: Placement;
  visibility: Visibility;
  classDecorated: boolean;
  derived: boolean;
};

const cells: Cell[] = [];
for (const kind of kinds) {
  for (const placement of placements) {
    for (const visibility of visibilities) {
      for (const classDecorated of [false, true]) {
        for (const derived of [false, true]) {
          cells.push({ kind, placement, visibility, classDecorated, derived });
        }
      }
    }
  }
}

function cellName(cell: Cell) {
  const flags = [cell.classDecorated ? "class decorator" : "", cell.derived ? "derived" : ""].filter(Boolean);
  return `${cell.kind}/${cell.placement}/${cell.visibility}${flags.length ? ` (${flags.join(", ")})` : ""}`;
}

// One class per cell: the decorated member `x` sits between undecorated
// instance fields, private fields, static fields and a static block. `dec`
// replaces every kind of member with one that appends "!" to its value, so
// the result also shows the decorator's return value was applied to the right
// member and nothing else.
function matrixClass(cell: Cell) {
  const { kind, placement, visibility, classDecorated, derived } = cell;
  const s = placement === "static" ? "static " : "";
  const name = visibility === "private" ? "#x" : "x";
  const self = placement === "static" ? "C" : "this";
  let member: string;
  let reader: string;
  switch (kind) {
    case "field":
      member = `@decApply ${s}${name} = L("x");`;
      reader = `${s}read() { return ${self}.${name}; }`;
      break;
    case "accessor":
      member = `@decApply ${s}accessor ${name} = L("x");`;
      reader = `${s}read() { return ${self}.${name}; }`;
      break;
    case "method":
      member = `@decApply ${s}${name}() { return "x"; }`;
      reader = `${s}read() { return ${self}.${name}(); }`;
      break;
    case "getter":
      member = `@decApply ${s}get ${name}() { return "x"; }`;
      reader = `${s}read() { return ${self}.${name}; }`;
      break;
    case "setter":
      member = `@decApply ${s}set ${name}(v) { side = v; }`;
      reader = `${s}read() { ${self}.${name} = "x"; return side; }`;
      break;
  }
  const id = JSON.stringify(cellName(cell));
  return `
{
  let side;
  class B { constructor() { L("base"); } }
  log.length = 0;
  ctxs = {};
  ${classDecorated ? "@decApply " : ""}class C ${derived ? "extends B " : ""}{
    static sBefore = L("sBefore");
    static { L("sBlock"); }
    iBefore = L("iBefore");
    #p = L("#p");
    iPriv = (L("iPriv"), this.#p);
    ${member}
    iAfter = L("iAfter");
    static sAfter = L("sAfter");
    static #sp = L("#sp");
    static sPriv = (L("sPriv"), C.#sp);
    #m() { return "m"; }
    callM() { return this.#m(); }
    has() { return #p in this; }
    ${reader}
  }
  const defLog = log.slice();
  log.length = 0;
  const inst = new C();
  out[${id}] = {
    defLog,
    ctorLog: log.slice(),
    value: ${placement === "static" ? "C.read()" : "inst.read()"},
    iPriv: inst.iPriv,
    sPriv: C.sPriv,
    callM: inst.callM(),
    has: inst.has(),
    ctx: ctxs[${JSON.stringify(name)}],
    classCtx: ctxs["C"] ?? null,
    isInstance: inst instanceof C${derived ? " && inst instanceof B" : ""},
  };
}`;
}

function matrixExpected(cell: Cell) {
  const { kind, placement, visibility, classDecorated, derived } = cell;
  const name = visibility === "private" ? "#x" : "x";
  const isFieldLike = kind === "field" || kind === "accessor";
  // Decorators are called before any static member is initialized; the class
  // decorator last. Static fields and blocks then run in source order.
  const defLog = [`dec:${name}`];
  if (classDecorated) defLog.push("dec:C");
  defLog.push("sBefore", "sBlock");
  if (isFieldLike && placement === "static") defLog.push("x");
  defLog.push("sAfter", "#sp", "sPriv");
  // Instance fields run after super() returns, in source order.
  const ctorLog = derived ? ["base"] : [];
  ctorLog.push("iBefore", "#p", "iPriv");
  if (isFieldLike && placement === "instance") ctorLog.push("x");
  ctorLog.push("iAfter");
  return {
    defLog,
    ctorLog,
    value: "x!",
    iPriv: "#p",
    sPriv: "#sp",
    callM: "m",
    has: true,
    ctx: { kind, name, static: placement === "static", private: visibility === "private" },
    classCtx: classDecorated ? { kind: "class", name: "C", static: null, private: null } : null,
    isInstance: true,
  };
}

const fixturePrelude = `
const log = [];
const L = (name) => (log.push(name), name);
let ctxs = {};
const dec = (value, ctx) => {
  log.push("dec:" + String(ctx.name));
  ctxs[String(ctx.name)] = { kind: ctx.kind, name: ctx.name, static: ctx.static ?? null, private: ctx.private ?? null };
};
const decApply = (value, ctx) => {
  dec(value, ctx);
  switch (ctx.kind) {
    case "field": return (v) => v + "!";
    case "accessor": return { init: (v) => v + "!" };
    case "method": return function (...args) { return value.call(this, ...args) + "!"; };
    case "getter": return function () { return value.call(this) + "!"; };
    case "setter": return function (v) { value.call(this, v + "!"); };
  }
};
const out = {};
const pending = [];
`;

// Fields keep [[Define]] semantics: a setter on the base class is not invoked,
// and the instance gets an own data property.
const installSection = `
{
  const calls = [];
  class Base {
    set f(v) { calls.push("f:" + v); }
    set g(v) { calls.push("g:" + v); }
    static set sf(v) { calls.push("sf:" + v); }
    static set sg(v) { calls.push("sg:" + v); }
  }
  class D extends Base {
    @dec f = 1;
    g = 2;
    @dec static sf = 3;
    static sg = 4;
    bar;
  }
  const d = new D();
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  out.install = {
    calls,
    own: [own(d, "f"), own(d, "g"), own(d, "bar")],
    staticOwn: [own(D, "sf"), own(D, "sg")],
    values: [d.f, d.g, d.bar, D.sf, D.sg],
  };
}`;

const installExpected = {
  calls: [],
  own: [true, true, true],
  staticOwn: [true, true],
  values: [1, 2, null, 3, 4],
};

const extraSections = `
// \`this\` in a static initializer, decorated or not, is the class.
{
  class S {
    @dec static x = this;
    static y = () => this;
    static z = this.x;
  }
  out.staticThis = [S.x === S, S.y() === S, S.z === S];
}

// Two decorated classes in one scope keep separate decorator contexts.
{
  const seen = [];
  const decInit = (value, ctx) => {
    ctx.addInitializer(function () { seen.push(ctx.name + ":" + this.constructor.name); });
  };
  class A1 { @decInit m() {} }
  class B1 { @decInit n() {} }
  new A1();
  new B1();
  out.twoClasses = seen;
}

// Generated names do not clash with user bindings.
{
  let _init = "user";
  let _x = "user_x";
  let _dec = "user_dec";
  class V { @dec m() {} #x = 1; getX() { return this.#x; } }
  out.collision = [_init, _x, _dec, new V().getX()];
}

// Undecorated \`accessor\` fields: initialization order is kept, and a class
// without decorators gets no Symbol.metadata.
{
  log.length = 0;
  class T {
    accessor a = L("a");
    b = L("b");
    static accessor c = L("c");
    static d = L("d");
  }
  const defLog = log.slice();
  log.length = 0;
  const t = new T();
  out.accessorOnly = { defLog, ctorLog: log.slice(), values: [t.a, t.b, T.c, T.d], symbols: Object.getOwnPropertySymbols(T).length };
}

// Decorator expressions and computed keys evaluate in source order, once.
{
  log.length = 0;
  const K = (n) => (log.push("k:" + n), n);
  const D = (n) => (log.push("d:" + n), dec);
  class Q {
    [K("m")]() { return "mv"; }
    @D("f") [K("f")] = L("fv");
    static [K("s")] = L("sv");
    [K("g")] = L("gv");
  }
  const defLog = log.slice();
  log.length = 0;
  const q = new Q();
  out.computed = { defLog, ctorLog: log.slice(), values: [q.m(), q.f, Q.s, q.g] };
  new Q();
  out.computedTwice = log.slice();
}

// A named class expression: its static code sees the class by its inner name.
{
  log.length = 0;
  const E = class Named {
    @dec m() {}
    static self = Named;
    static { L("eblk"); }
    y = Named;
  };
  out.namedExpr = { defLog: log.slice(), self: E.self === E, y: new E().y === E };
}

// Derived class with an explicit constructor: fields initialize after super().
{
  log.length = 0;
  class Base2 { constructor() { L("base"); } }
  class Der extends Base2 {
    a = L("a");
    @dec b = L("b");
    constructor() { L("pre"); super(); L("post"); }
  }
  new Der();
  out.derived = log.slice();
}

// Private accessors and private methods next to a decorated member.
{
  class PA {
    @dec m() {}
    accessor #acc = L("acc");
    static accessor #sacc = 5;
    get acc() { return this.#acc; }
    set acc(v) { this.#acc = v; }
    static bump() { return ++PA.#sacc; }
    static { PA.#sacc += 10; }
  }
  const pa = new PA();
  const before = pa.acc;
  pa.acc = 7;
  out.privateAccessor = [before, pa.acc, PA.bump()];
}

// Undecorated \`#private\` members of a decorated class stay native, so every
// update and compound assignment form works on them.
{
  let n = 0;
  class U {
    @dec m() {}
    #x = "5";
    #b = 1n;
    static #s = 1;
    static run(o) {
      const mk = () => (n++, o);
      const r1 = ++o.#x;
      const r2 = o.#x++;
      o.#x -= 1;
      o.#x ??= 100;
      o.#b++;
      U.#s += 2;
      mk().#x *= 2;
      mk().#x ||= 0;
      return [r1, r2, o.#x, o.#b.toString() + "n", U.#s, n];
    }
  }
  out.privateUpdates = U.run(new U());
}

// \`super\`, \`this\` and nested scopes in the static code of a decorated
// class. The expected values are what node prints for the same class without
// the decorator.
{
  let n = 0;
  class SBase {
    static count = 10;
    static get y() { return "by"; }
    static m(a) { return "bm:" + a + ":" + this.name; }
    static set z(v) { SBase.z_ = v; }
  }
  class SDer extends SBase {
    @dec static q = 1;
    static a = super.y;
    static b = super.m("arg");
    static c = (super.z = 5);
    static d = () => super["y"];
    static { SDer.e = super.m("blk"); }
    static f = (super.count += 5);
    static g = ++super.count;
    static h = super.count++;
    static i = (super.z ??= 7);
    static j = super[(n++, "y")];
    static k = (super[(n++, "count")] -= 1);
    static l = (super[(n++, "count")]--, SDer.count);
    static obj = { [this.q]: this.q, m() { return super.toString === Object.prototype.toString; } };
    static fn = (a = this.q, { b = this.q } = {}) => [a, b];
    static nested = class Inner extends (this.q, SBase) { static [this.q] = 2; static w = SDer.q; };
    static asyncFn = async () => { await null; return this.q; };
    static { const { x = this.q } = {}; const [y = this.q] = []; SDer.destructured = [x, y]; }
  }
  out.superStatic = [SDer.a, SDer.b, SDer.c, SDer.d(), SDer.e, SDer.f, SDer.g, SDer.h, SDer.i, SDer.j, SDer.k, SDer.l, SDer.count, SBase.count, SBase.z_, n];
  out.staticScopes = [SDer.obj[1], SDer.obj.m(), SDer.fn(), SDer.nested[1], SDer.nested.w, SDer.destructured];
  pending.push(SDer.asyncFn().then((v) => { out.staticScopesAsync = v; }));
}

// The inner name of a class expression, in nested scopes of its static code.
{
  const E = class Named {
    @dec m() {}
    static #p = 3;
    static inner = class { static w = Named.#p; static [Named.#p] = "k"; m() { return Named; } };
    static obj = { [Named.#p]: Named.#p, get g() { return Named.#p; } };
    static fn = (a = Named.#p, { b = Named.#p } = {}) => [a, b, Named];
    static { const { x = Named.#p } = {}; for (const y of [Named.#p]) Named.z = x + y; }
  };
  out.namedExprNested = [E.inner.w, E.inner[3], new E.inner().m() === E, E.obj[3], E.obj.g, E.fn().slice(0, 2), E.fn()[2] === E, E.z];
}

// Every form of \`super\` and of an undecorated private member in a decorated
// class, with \`Reflect\` and \`Object\` shadowed. The expected values are what
// node prints for the same class without the decorator.
{
  const Reflect = null;
  const Object = null;
  class SB {
    static v = 1;
    static get g() { return "g"; }
    static tag(s, ...vals) { return this.name + ":" + s.raw.join("|") + vals.join(","); }
    static sm() { return "sm:" + this.name; }
    greet() { return "hi:" + this.n; }
  }
  class SC extends SB {
    @dec static m() {}
    n = 7;
    static y = super.v;
    static opt1 = super.missing?.();
    static opt2 = super.sm?.();
    static destructured = ([super.d1, { k: super.d2 = 9 }, ...super.rest] = [5, {}, 6, 7], [SC.d1, SC.d2, SC.rest]);
    static loop = (() => {
      const seen = [];
      for (super.it of [1, 2]) seen.push(SC.it);
      for (super.key in { a: 1 }) seen.push(SC.key);
      return seen;
    })();
    static {
      try {
        SC.fail = (super.g = 1);
      } catch (e) {
        SC.readonlyError = e.constructor.name + ": " + e.message;
      }
    }
    #pm() { return super.greet() + "/" + super.sm?.() + "/" + super.missing?.(); }
    static #spm() { return super.sm() + "/" + super.g; }
    #tag(s, ...vals) { return this.n + ":" + s.raw.join("|") + vals.join(","); }
    #a = 1;
    #b = 2;
    swap() {
      [this.#a, this.#b] = [this.#b, this.#a];
      ({ x: this.#a = 10 } = {});
      for (this.#b of [30]) {}
      return [this.#a, this.#b];
    }
    call() { return [this.#pm(), SC.#spm(), this.#tag\`q\${1}\`]; }
  }
  out.superForms = [SC.y, SC.opt1, SC.opt2, SC.destructured, SC.loop, SC.readonlyError];
  out.privateForms = [new SC().call(), new SC().swap()];
}

// https://github.com/oven-sh/bun/issues/28118
{
  const id = (value, context) => value;
  class Broken {
    @id accessor label = "";
    #name = "hello";
    #callback = () => this.#name;
    run() { return this.#callback(); }
  }
  out.issue28118 = new Broken().run();
}

// https://github.com/oven-sh/bun/issues/31917
{
  const pick = (x) => x;
  const C = class Foo {
    static #m = function (tag) { return { tag }; };
    @dec static s = Foo.#m("s").tag;
    @dec static t = pick(this).#m("t").tag;
  };
  out.issue31917 = [C.s, C.t];
}

// https://github.com/oven-sh/bun/issues/31929
{
  const C = class Foo {
    @dec static s = (class { @dec static x = Foo; }).x;
  };
  out.issue31929 = [typeof C.s, C.s === C];
}

// https://github.com/oven-sh/bun/issues/28010 and /28316: each class keeps
// its own decorator context, so subclasses and siblings do not mix up
// field initializer slots.
{
  const seen = [];
  const decorate = (name) => (_value, context) => (initialValue) => {
    seen.push(name + ":" + String(context.name) + "=" + initialValue);
    return initialValue;
  };
  class Parent {
    @decorate("Parent.foo") foo = "parent_foo";
    @decorate("Parent.shared") shared = "parent_shared";
  }
  class Child extends Parent {
    @decorate("Child.foo") foo = "child_foo";
    @decorate("Child.childOnly") childOnly = "child_childOnly";
  }
  new Child();
  out.issue28010 = seen;
}

// https://github.com/oven-sh/bun/issues/29837
{
  class A { accessor name = "A"; }
  class B extends A {
    accessor name = "B";
    names() { return [this.name, super.name]; }
  }
  out.issue29837 = new B().names();
}

// Private names in static blocks and static initializers of a lowered class:
// brand checks, private calls, a function declared in the block, and a nested
// class that keeps its own private fields.
{
  class SB {
    @dec m() {}
    #a() { return "a"; }
    static #s() { return "s"; }
    accessor #x = 0;
    static accessor y = #a in new SB();
    static {
      function check(o) { return #a in o; }
      SB.checks = [#a in new SB(), #a in {}, #x in new SB(), check(new SB()), check({}), this.#s()];
      class Inner { accessor b = 1; #y = 0; inc() { return this.#y++; } }
      const inner = new Inner();
      inner.inc();
      SB.inner = [inner.inc(), inner.b];
    }
    inc() { return this.#x++; }
  }
  const sb = new SB();
  sb.inc();
  out.staticBlockPrivate = [SB.checks, SB.y, SB.inner, sb.inc()];
}

// A plain function in a static initializer keeps its own \`this\`, and a
// shadowing binding of the class name wins.
{
  const C = class Foo {
    @dec static fn = function () { return this; };
    @dec static shadow = (function Foo() { return Foo; })();
  };
  const obj = {};
  out.nestedScopes = [C.fn.call(obj) === obj, typeof C.shadow === "function" && C.shadow !== C];
}

// Generated names avoid globals the file references only after the class,
// a method parameter named like a lowered member's storage, and a class
// named like a temporary.
{
  globalThis._init = "global init";
  globalThis._G = "global G";
  class G { @dec m() {} }
  class Store {
    #value = 0;
    @dec set(_value) { this.#value = _value; return this; }
    get() { return this.#value; }
  }
  const answer = (value, ctx) => () => 42;
  @dec class init { @dec m() { return init; } }
  const K = class { @answer x = 1; };
  out.temporaryNames = [_init, _G, typeof G, new Store().set(5).get(), new init().m() === init, new K().x];
}

// The temporary that captures a private call receiver does not clobber a
// user binding of the same name, and two class expressions in sibling blocks
// do not share their hoisted temporaries.
{
  const _obj = "outer";
  class R {
    @dec m() {}
    #secret() { return "secret"; }
    static #staticSecret() { return "static secret"; }
    self() { return this; }
    static self() { return R; }
    run() { return [this.self().#secret(), _obj]; }
    static { R.fromBlock = [R.self().#staticSecret(), _obj]; }
  }
  let A2, B2;
  { A2 = class { @dec m() {} accessor x = "a"; }; }
  const a2 = new A2();
  { B2 = class { @dec m() {} accessor x = "b"; }; }
  out.temporaryScopes = [...new R().run(), ...R.fromBlock, a2.x, new B2().x];
}

// Accessor keys that are not identifiers.
{
  class SK {
    accessor "x y" = 1;
    @dec accessor "x-y" = 2;
    static accessor "x y" = 3;
    accessor 0 = 4;
  }
  const sk = new SK();
  sk["x y"] += 10;
  out.accessorKeys = [sk["x y"], sk["x-y"], SK["x y"], sk[0]];
}

// https://github.com/oven-sh/bun/issues/31921: a class with accessors and no
// decorators. Its private names stay reachable from its static code, and
// static accessor initializers keep their order against static blocks.
{
  log.length = 0;
  const C1 = class Foo {
    static #m = function (tag) { return { tag }; };
    static accessor a = Foo.#m("a").tag;
  };
  const C2 = class Foo {
    static accessor a = 1;
    static #m = 5;
    static { L(this.#m); }
  };
  const C3 = class {
    static accessor a = L("a");
    static { L("block"); }
    static accessor b = L("b");
  };
  out.issue31921 = [C1.a, C2.a, C3.a, C3.b, log.slice()];
}

// Accessor storage is per member: an instance and a static accessor of one
// name, a user \`#a\` next to \`accessor a\`, and an enclosing class's private
// name do not share it. A computed accessor key evaluates once and is shared
// by the getter and the setter, with and without a decorator in the class.
{
  let n = 0;
  const key = (k) => (n++, k);
  class N {
    #a = 1;
    accessor a = 2;
    static accessor a = 3;
    accessor [key("k")] = 4;
    priv() { return this.#a; }
  }
  class M {
    @dec m() {}
    accessor [key("k")] = 5;
  }
  class Outer {
    static #a = 6;
    static make() { return class { static accessor a = Outer.#a; }; }
  }
  const nn = new N();
  nn.a += 10;
  N.a += 10;
  nn.k += 10;
  const mm = new M();
  mm.k += 10;
  const desc = Object.getOwnPropertyDescriptor(N.prototype, "k");
  out.accessorStorage = [nn.a, N.a, nn.priv(), nn.k, mm.k, n, typeof desc.get, typeof desc.set, Outer.make().a];
}
`;

const extraExpected = {
  staticThis: [true, true, true],
  twoClasses: ["m:A1", "n:B1"],
  collision: ["user", "user_x", "user_dec", 1],
  accessorOnly: { defLog: ["c", "d"], ctorLog: ["a", "b"], values: ["a", "b", "c", "d"], symbols: 0 },
  computed: {
    defLog: ["k:m", "d:f", "k:f", "k:s", "k:g", "dec:f", "sv"],
    ctorLog: ["fv", "gv"],
    values: ["mv", "fv", "sv", "gv"],
  },
  computedTwice: ["fv", "gv", "fv", "gv"],
  namedExpr: { defLog: ["dec:m", "eblk"], self: true, y: true },
  derived: ["dec:b", "pre", "base", "a", "b", "post"],
  privateAccessor: ["acc", 7, 16],
  privateUpdates: [6, 6, 12, "2n", 3, 2],
  superStatic: ["by", "bm:arg:SDer", 5, "by", "bm:blk:SDer", 15, 11, 10, 7, "by", 9, 9, 9, 10, 7, 3],
  staticScopes: [1, true, [1, 1], 2, 1, [1, 1]],
  staticScopesAsync: 1,
  namedExprNested: [3, "k", true, 3, 3, [3, 3], true, 6],
  superForms: [1, null, "sm:SC", [5, 9, [6, 7]], [1, 2, "a"], "TypeError: Attempted to assign to readonly property."],
  privateForms: [
    ["hi:7/undefined/undefined", "sm:SC/g", "7:q|1"],
    [10, 30],
  ],
  issue28118: "hello",
  issue31917: ["s", "t"],
  issue31929: ["function", true],
  issue28010: [
    "Parent.foo:foo=parent_foo",
    "Parent.shared:shared=parent_shared",
    "Child.foo:foo=child_foo",
    "Child.childOnly:childOnly=child_childOnly",
  ],
  issue29837: ["B", "A"],
  staticBlockPrivate: [[true, false, true, true, false, "s"], true, [1, 1], 1],
  nestedScopes: [true, true],
  temporaryNames: ["global init", "global G", "function", 5, true, 42],
  temporaryScopes: ["secret", "outer", "static secret", "outer", "a", "b"],
  accessorKeys: [11, 2, 3, 4],
  issue31921: ["a", 1, "a", "b", [5, "a", "block", "b"]],
  accessorStorage: [12, 13, 1, 14, 15, 2, "function", "function", 6],
};

function buildFixture() {
  let src = fixturePrelude;
  for (const cell of cells) {
    src += matrixClass(cell);
  }
  src += installSection;
  src += extraSections;
  src += `\nPromise.all(pending).then(() => console.log(JSON.stringify(out)));\n`;
  return src;
}

function buildExpected() {
  const expected: Record<string, unknown> = {};
  for (const cell of cells) {
    expected[cellName(cell)] = matrixExpected(cell);
  }
  expected.install = installExpected;
  Object.assign(expected, extraExpected);
  return expected;
}

type Mode = {
  name: string;
  file: string;
  bundle: boolean;
};

const modes: Mode[] = [
  { name: ".js", file: "main.js", bundle: false },
  { name: ".ts", file: "main.ts", bundle: false },
  { name: ".js bundled", file: "main.js", bundle: true },
];

// Runs the fixture once per mode.
async function runMode(mode: Mode) {
  using dir = tempDir("es-dec-matrix", {
    [mode.file]: buildFixture(),
    "tsconfig.json": "{}",
  });
  let entry = mode.file;
  if (mode.bundle) {
    const build = await runIn(String(dir), ["build", mode.file, "--target=bun", "--outfile=bundled.js"]);
    if (build.exitCode !== 0) return { out: {}, stderr: filterStderr(build.stderr), exitCode: build.exitCode };
    entry = "bundled.js";
  }
  const { stdout, stderr, exitCode } = await runIn(String(dir), [entry]);
  return { out: exitCode === 0 ? JSON.parse(stdout) : {}, stderr: filterStderr(stderr), exitCode };
}

const matrixRuns = await Promise.all(modes.map(runMode));

describe("ES decorators lowering matrix", () => {
  modes.forEach((mode, i) => {
    describe(mode.name, () => {
      const { out, stderr, exitCode } = matrixRuns[i];
      const expected = buildExpected();

      test("the fixture runs", () => {
        expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
        expect(Object.keys(out).sort()).toEqual(Object.keys(expected).sort());
      });

      for (const key of Object.keys(expected)) {
        test(key, () => {
          // JSON turns `undefined` into `null`.
          expect(out[key]).toEqual(expected[key]);
        });
      }
    });
  });
});
