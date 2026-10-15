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
    // A call of a decorated `#private` member stays as it is written: the
    // receiver is evaluated once, and a chain like `o.#m().#m().#m()` is
    // printed once.
    test("chained optional private calls do not explode the transpiled output size", () => {
      const chain = "?.Foo.#m()".repeat(20);
      const source = `class Foo {
        static #x = -0;
        @decorator() static #m = function() {};
        @decorator() est() {
          return [o${chain}];
        }
      }`;

      const transpiler = new Bun.Transpiler({ loader: "js", target: "bun" });
      const output = transpiler.transformSync(source);

      // A lowering that printed the receiver twice per call gave about 47 MB
      // for this chain.
      expect(output.length).toBeLessThan(50_000);
      // The lowered output must still be valid syntax.
      expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(output)).not.toThrow();
    });

    test("double-call private chains in decorated static field initializers stay linear", () => {
      // The receiver of each `.#method()()` link is everything before it.
      const chain = ".#method()()".repeat(20);
      const source = `class C {
        @decorator() static s = new C()${chain.slice(0, -2)};
        @decorator() #method() { return 1e999; }
      }`;

      const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun", deadCodeElimination: true });
      const output = transpiler.transformSync(source);

      // A lowering that printed the receiver twice per link gave about 64 MB
      // for 20 links.
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
          @dec #method() { evals++; const self = this; return () => self; }
        }
        console.log(C.s instanceof C, evals);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("true 3\n");
      expect(exitCode).toBe(0);
    });

    test("a call that runs again from inside a decorated #private getter keeps its receiver", async () => {
      // The getter runs between the read of the receiver and the call of what
      // it returns, and it reaches the same call with another receiver.
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return value; }
        let nextId = 0;
        let depth = 0;
        const order = [];
        class C {
          @dec get #g() {
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
          @dec static #m = function (x) { return [this === Counter, x]; };
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
          @dec #next() { return { Chain: new Chain(this.#tag + 1) }; }
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
          @dec #p(n) { return "p" + n; }
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

    // A receiver in a method body and one in a field initializer, which is
    // outside every function body of the class.
    test("decorated class expression evaluates chained private call receivers once", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        function dec(value, ctx) { return value; }
        let evals = 0;
        let initEvals = 0;
        function pick(x) { initEvals++; return x; }
        const C = class Foo {
          @dec static #m = function (tag) { return { Foo, tag }; };
          @dec #p(tag) { return "i" + tag; }
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

  // `bun run` has no symbol renamer: the lowering's `var _init`, `var _dec` and
  // its other temporaries are printed under the name the parser gave them, so
  // that name has to be unique in the file.
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

    test.concurrent("new.target stays undefined in the initializer of the last instance field", async () => {
      // No later field can carry the initializer of a lowered member here.
      const { stdout, stderr, exitCode } = await runDecorator(`
        const dec = (v, ctx) => {};
        class A { x = 0; @dec #p = typeof new.target; get p() { return this.#p } }
        class B { x = 0; accessor p = typeof new.target; }
        class C { @dec accessor p = typeof new.target; }
        class D { @dec accessor #p = typeof new.target; get p() { return this.#p } }
        class E extends Object { accessor p = typeof new.target; constructor() { super(); } }
        console.log(JSON.stringify([A, B, C, D, E].map(K => new K().p)));
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe('["undefined","undefined","undefined","undefined","undefined"]\n');
      expect(exitCode).toBe(0);
    });

    test.concurrent("an undecorated accessor is a #private field, a getter and a setter", async () => {
      using dir = tempDir("es-dec-accessor-shape", {
        "test.js": `export class A { accessor x = 1; static accessor y = 2; #x = 3; }`,
      });
      const { stdout, stderr, exitCode } = await runIn(String(dir), ["build", "--no-bundle", "test.js"]);
      expect(filterStderr(stderr)).toBe("");
      expect(stdout.replace(/\s+/g, " ").trim()).toBe(
        "export class A { #x2 = 1; get x() { return this.#x2; } set x(v) { this.#x2 = v; } " +
          "static #y = 2; static get y() { return this.#y; } static set y(v) { this.#y = v; } #x = 3; }",
      );
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

  // A decorated `#private` member stays a member of the class, so the engine
  // runs each use of it. A decorated `#private` method, getter, setter or
  // accessor is a `get` or `set` of its name that gives what the decorators
  // returned.
  describe("a decorated #private member stays a member of the class", () => {
    test("the lowered class declares the name and calls no helper where it is used", () => {
      const transpiler = new Bun.Transpiler({ loader: "js", target: "bun" });
      const output = transpiler.transformSync(`
        class A extends B {
          @dec #x = 1;
          @dec #m() { return 1; }
          @dec accessor #a = 2;
          run(o) { this.#x++; [o.#a] = [this.#m?.()]; return o?.#x; }
        }
      `);
      expect(output).toContain("this.#x++;");
      expect(output).toContain("[o.#a] = [this.#m?.()];");
      expect(output).toContain("return o?.#x;");
      expect(output).toContain("{ has: (o) => (#x in o), get: (o) => o.#x, set: (o, v) => o.#x = v }");
      expect(output).not.toMatch(/__private|WeakMap|WeakSet/);
      expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(output)).not.toThrow();
    });

    test("the temporaries of a class are declared once for each evaluation of it", () => {
      const transpiler = new Bun.Transpiler({ loader: "js", target: "bun" });
      const lowered = (source: string) => transpiler.transformSync(source).replace(/\$\d+|_[a-z0-9]{8}\b/g, "");
      // Where the statements around the class run once for each evaluation
      // of it, they declare the temporaries: with `let` in the body of a loop.
      expect(lowered("class A { @dec x }")).toContain("var _init, _dec;\n\nclass A {");
      expect(lowered("function f() { return class { @dec x }; }")).toContain("{\n  var _init, _dec;\n  return class {");
      expect(lowered("for (;;) { class A { @dec x } }")).toContain("{\n  let _init, _dec;\n\n  class A {");
      expect(lowered("for (;;) f(class { @dec x });")).toContain("{\n  let _init, _dec;\n  f(class {");
      expect(lowered("for (;;) f(() => class { @dec x });")).toContain(
        "=> {\n    var _init, _dec;\n    return class {",
      );
      expect(lowered("class O { static k = class { @dec x } }")).toContain("var _init, _dec;\n\nclass O {");
      // Where they do not, an arrow function around the class declares them.
      expect(lowered("function f(K = class { @dec x }) {}")).toContain(
        "function f(K = (() => {\n  var _init, _dec;\n  return { K: class {",
      );
      expect(lowered("class O { k = class { @dec x } }")).toContain("k = (() => {\n    var _init, _dec;\n    return {");
      expect(lowered("while (f(class { @dec x }));")).toContain(
        "while (f((() => {\n  var _init, _dec;\n  return class {",
      );
      const ts = new Bun.Transpiler({ loader: "ts", target: "bun" });
      expect(
        ts.transformSync("enum E { A = new (class { @dec accessor x = 1 })().x }").replace(/\$\d+/g, ""),
      ).toContain("new ((() => {\n  var _init, _dec;\n  return class {");
      // An arrow function cannot hold an `await` of the function around it.
      expect(lowered("async function f() { while (f(class { @(await dec) x })); }")).toContain(
        "{\n  var _init, _dec;\n  while (f(class {",
      );
    });

    test.concurrent("a long expression in a class with a decorated #private member", async () => {
      // 30,000 operands: nothing walks the body of the class a second time.
      const { stdout, stderr, exitCode } = await runDecorator(`
        const body = Buffer.alloc(60000, "a+").toString() + "1";
        const output = new Bun.Transpiler({ loader: "js" }).transformSync("class A { @d #p() {} m() { return " + body + " } }");
        console.log(output.split("+").length);
      `);
      expect(stderr).toBe("");
      expect(stdout).toBe("30001\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("bun test --coverage counts no function of the lowering as never called", async () => {
      using dir = tempDir("es-dec-private-coverage", {
        "used.js": `
          const dec = (v, ctx) => {};
          export class A {
            v = 1;
            @dec #method() { return "m" + this.v; }
            @dec get #pair() { return this.v + 40; }
            @dec set #pair(v) { this.v = v; }
            @dec accessor #accessor = 2;
            @dec #field = 1;
            @dec static #sMethod() { return "sm"; }
            @dec static accessor #sAccessor = 7;
            @dec static #sField = 5;
            run() { this.#field++; this.#accessor++; this.#pair++; return [this.#field, this.#accessor, this.#method(), this.#pair]; }
            static run() { A.#sField++; A.#sAccessor++; return [A.#sField, A.#sAccessor, A.#sMethod()]; }
          }
        `,
        // Nothing writes to an accessor here, and nothing uses `#unused`.
        "read.js": `
          const dec = (v, ctx) => {};
          export class Model {
            @dec accessor #id = 1;
            @dec accessor title = "t";
            accessor plain = 2;
            @dec #unused = 3;
            get id() { return this.#id; }
            name() { return "m" + this.id + this.title + this.plain; }
          }
        `,
        "model.test.js": `
          import { expect, test } from "bun:test";
          import { A } from "./used.js";
          import { Model } from "./read.js";
          test("every member is read, written or called", () => {
            expect([new A().run(), A.run()]).toEqual([[2, 3, "m42", 82], [6, 8, "sm"]]);
          });
          test("every accessor is read", () => {
            expect(new Model().name()).toBe("m1t2");
          });
        `,
      });
      const { stdout, stderr, exitCode } = await runIn(String(dir), ["test", "--coverage", "./model.test.js"]);
      // A debug build also lists the test file.
      const rows = (stdout + stderr)
        .split("\n")
        .map(line => line.split("|").map(cell => cell.trim()))
        .filter(([file]) => file === "read.js" || file === "used.js");
      expect(rows).toEqual([
        ["read.js", "100.00", "100.00", ""],
        ["used.js", "100.00", "100.00", ""],
      ]);
      expect(exitCode).toBe(0);
    });
  });

  // The value of an `accessor` is a `#private` field of the class, with a name
  // that the class and the classes around it do not use.
  describe("accessor storage", () => {
    test.concurrent("an exported class next to a lowered top-level using", async () => {
      // The lowered `using` is in a `try` block. So is a class that computes
      // the value of a `static accessor`, which has to run after it. A class
      // that computes nothing stays exported where it is written, before a
      // class that extends it.
      using dir = tempDir("es-dec-accessor-using", {
        "entry.mjs": `
          const log = [];
          using first = { [Symbol.dispose]() {}, v: log.push("using") };
          export class A { static accessor a = log.push("accessor"); }
          export class Base { static x = 0; accessor y = 1; }
          export class Derived extends Base {}
          export class Plain { static x = 2; }
          export class PlainDerived extends Plain {}
          console.log(log.join(), Derived.x, new Derived().y, PlainDerived.x);
        `,
      });
      const build = await runIn(String(dir), ["build", "--target=node", "entry.mjs", "--outfile=out.mjs"]);
      expect({ stderr: filterStderr(build.stderr), exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const { stdout, stderr, exitCode } = await runIn(String(dir), ["out.mjs"]);
      expect(filterStderr(stderr)).toBe("");
      expect(stdout).toBe("using,accessor 0 1 2\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("the #private names the lowering adds in a minified bundle", async () => {
      using dir = tempDir("es-dec-accessor-minify", {
        // Next to the names of the class and of a class around it.
        "names.js": `
          const dec = (v, ctx) => {};
          class Outer {
            #a = "outer";
            static make() {
              return class {
                #b = "b"; #c = "c"; #d = "d";
                accessor a = "first";
                accessor a = "second";
                @dec accessor e = "e";
                @dec accessor #f = "f";
                @dec #g = "g";
                static accessor s = "s";
                read(o) { this.#g += "!"; return [this.a, o.#a, this.#b, this.#c, this.#d, this.e, this.#f, this.#g, this.constructor.s]; }
              };
            }
          }
          export default new (Outer.make())().read(new Outer());
        `,
        // Next to a name that a direct eval keeps as it is written.
        "evaluated.js": `
          class A {
            #e = "user";
            accessor x = 1;
            peek() { return eval("this.#e"); }
          }
          const o = new A();
          export default [o.peek(), o.x];
        `,
        // A derived constructor without a `super();` statement: what follows
        // the last field rides in one more `#private` field.
        "tail.js": `
          const dec = (v, ctx) => { ctx.addInitializer(function () { this.ran = true; }); };
          class Base {}
          class Outer {
            #_ = "outer";
            static make() {
              return class extends Base {
                #_2 = "own";
                @dec x = "x";
                constructor() { const made = super(); }
                read(o) { return [o.#_, this.#_2, this.x, this.ran]; }
              };
            }
          }
          export default new (Outer.make())().read(new Outer());
        `,
        "entry.js": `
          import names from "./names.js";
          import evaluated from "./evaluated.js";
          import tail from "./tail.js";
          console.log(JSON.stringify({ names, evaluated, tail }));
        `,
      });
      const build = await runIn(String(dir), ["build", "--target=bun", "--minify", "entry.js", "--outfile=out.js"]);
      expect({ stderr: filterStderr(build.stderr), exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const { stdout, stderr, exitCode } = await runIn(String(dir), ["out.js"]);
      expect(filterStderr(stderr)).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        names: ["second", "outer", "b", "c", "d", "e", "f", "g!", "s"],
        evaluated: ["user", 1],
        tail: ["outer", "own", "x", true],
      });
      expect(exitCode).toBe(0);
    });

    test.concurrent("a bundle keeps the names of the file next to the functions of the lowering", async () => {
      using dir = tempDir("es-dec-accessor-scope", {
        "entry.js": `
          const dec = (v, ctx) => {};
          export class A { @dec accessor x = 1; @dec #y = 2; }
          export const inc = (list) => list.map((o) => o + 1).map((v) => v * 2);
        `,
      });
      const { stdout, stderr, exitCode } = await runIn(String(dir), ["build", "--target=bun", "entry.js"]);
      expect(filterStderr(stderr)).toBe("");
      expect(stdout).toContain("list.map((o) => o + 1).map((v) => v * 2)");
      expect(exitCode).toBe(0);
    });

    test("a class with many accessors whose storage has one name", () => {
      // Every key here gives the storage the same name, with a number after it.
      const count = 3000;
      const members = Array.from({ length: count }, (_, i) => `accessor ${i} = ${i};`).join(" ");
      const output = new Bun.Transpiler({ loader: "js" }).transformSync(`class A { ${members} }`);
      expect(new Set(output.match(/#accessor_storage\d*(?= = )/g)).size).toBe(count);
    });

    test.concurrent("a class with only accessors needs no helper: CommonJS and tree shaking", async () => {
      using dir = tempDir("es-dec-accessor-no-helper", {
        "lib.cjs": `
          class A { accessor x = 1; static accessor y = 2; }
          module.exports = { A };
        `,
        "cjs.cjs": `
          const { A } = require("./lib.cjs");
          const a = new A();
          a.x += 1;
          console.log(a.x, A.y);
        `,
        "unused.js": `
          export class Unused { accessor x = 1; static accessor y = 2; }
          export const used = "used";
        `,
        "esm.js": `
          import { used } from "./unused.js";
          console.log(used);
        `,
      });
      const cjs = await runIn(String(dir), ["cjs.cjs"]);
      expect({ ...cjs, stderr: filterStderr(cjs.stderr) }).toEqual({ stdout: "2 2\n", stderr: "", exitCode: 0 });
      const build = await runIn(String(dir), ["build", "--target=bun", "esm.js"]);
      expect(filterStderr(build.stderr)).toBe("");
      expect(build.stdout).toContain('"used"');
      expect(build.stdout).not.toContain("Unused");
      expect(build.exitCode).toBe(0);
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

// A call of a decorated \`#private\` method leaves a user binding named
// \`_obj\` alone, and two class expressions in sibling blocks do not share
// their hoisted temporaries.
{
  const _obj = "outer";
  class R {
    @dec m() {}
    @dec #secret() { return "secret"; }
    @dec static #staticSecret() { return "static secret"; }
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

// What a decorated `#private` member and the value of an `accessor` do as
// members of the class. These sections are a module of their own: where one of
// them does not load, the matrix still runs.
const memberSections = `
// Every way to write to a decorated \`#private\` member. The expected values
// are what node prints for the same classes without the decorators.
{
  let n = 0;
  let sets = 0;
  const caught = (fn) => { try { return fn(); } catch (e) { return e.constructor.name; } };
  class W {
    @dec #f = "5";
    @dec #b = 1n;
    @dec #o = { k: 1, list: [1] };
    @dec accessor #a = 1;
    #pair = 10;
    @dec get #g() { return this.#pair; }
    @dec set #g(v) { sets++; this.#pair = v; }
    @dec static #s = 1;
    @dec #m() { return "m"; }
    @dec get #ro() { return 1; }
    @dec set #wo(v) {}
    @dec #init = 1;
    other = null;
    static update(o) {
      const mk = () => (n++, o);
      const r = [++o.#f, o.#f++, o.#f--, --o.#f, o.#f];
      o.#b++;
      --o.#b;
      r.push((o.#b++).toString(), (++o.#b).toString());
      r.push(o.#a++, ++o.#a, o.#g--, --o.#g, W.#s++, ++W.#s, this.#s--);
      r.push(mk().#f++, ++mk().#a, mk().#g++, o.#f, o.#a, o.#g);
      r.push(o.#o.k++, ++o.#o.list[0], typeof o.#f, -o.#f, void o.#f++, o.#f);
      for (o.#f = 0; o.#f < 3; o.#f++) r.push(o.#f);
      return r;
    }
    compound() {
      const mk = () => (n++, this);
      this.#f = 7;
      const r = [this.#f += 2, this.#f -= 1, this.#f *= 3, this.#f /= 2, this.#f %= 7, this.#f **= 2];
      r.push(this.#f <<= 2, this.#f >>= 1, this.#f >>>= 1, this.#f |= 9, this.#f &= 12, this.#f ^= 5);
      r.push(this.#f += "s", (this.#b += 2n).toString());
      r.push(this.#a += 5, this.#g -= 3, W.#s *= 10, mk().#f += "t", mk().#a -= 1, mk().#g *= 2);
      r.push(this.#o.k += 5, this.#o.list[0] *= 4, this.#f = this.#a += 1, this.#f);
      return r;
    }
    logical() {
      const mk = () => (n++, this);
      const rhs = (v) => (n += 100, v);
      this.#f = null;
      this.#a = 0;
      this.#g = 1;
      sets = 0;
      const r = [this.#f ??= rhs("a"), this.#f ??= rhs("b"), this.#f ||= rhs("c"), this.#f &&= rhs("d"), this.#f];
      r.push(this.#a ||= rhs(2), this.#a ||= rhs(3), this.#a &&= rhs(0), this.#a &&= rhs(4), this.#a ??= rhs(5), this.#a);
      r.push(this.#g &&= rhs(0), this.#g &&= rhs(1), this.#g ||= rhs(6), this.#g ||= rhs(7), this.#g ??= rhs(8), sets);
      r.push(mk().#f &&= rhs(null), mk().#f ??= rhs("e"), mk().#f ||= rhs("f"), mk().#g &&= rhs(9), W.#s &&= rhs(2));
      r.push(0 || (this.#f &&= rhs("g")), (this.#a &&= rhs(0)) || "h", null ?? (this.#f ||= rhs("i")), n);
      return r;
    }
    destructuring(other) {
      const mk = () => (n++, this);
      const r = [];
      [this.#f, this.#a] = [1, 2];
      [this.#f, this.#a] = [this.#a, this.#f];
      r.push(this.#f, this.#a);
      ({ f: this.#f, a: this.#a, g: this.#g, s: W.#s } = { f: 3, a: 4, g: 5, s: 6 });
      r.push(this.#f, this.#a, this.#g, W.#s);
      [this.#f = 7, [this.#a = 8, { g: this.#g = 9 }]] = [undefined, [undefined, {}]];
      r.push(this.#f, this.#a, this.#g);
      [this.#f, ...this.#a] = [10, 11, 12];
      ({ f: this.#f, ...this.#g } = { f: 13, x: 14 });
      r.push(this.#f, this.#a, this.#g);
      ({ [this.#f]: this.#a = this.#f, x: this.#o.k, y: this.#o.list[0] } = { x: 15, y: 16 });
      r.push(this.#a, this.#o.k, this.#o.list[0]);
      [mk().#f, other.#f, mk().other.#a] = [17, 18, 19];
      r.push(this.#f, other.#f, other.#a);
      r.push(([this.#f] = [20]).length, this.#f);
      const arrow = (a = ([this.#f] = [21])) => [a[0], this.#f];
      r.push(arrow());
      return r;
    }
    loopHeads() {
      const mk = () => (n++, this);
      const r = [];
      for (this.#f of [1, 2]) r.push(this.#f);
      for (this.#a in { x: 1, y: 2 }) r.push(this.#a);
      for ([this.#f, this.#g = 3] of [[4], [5, 6]]) r.push(this.#f, this.#g);
      for ({ k: this.#a, ...this.#f } of [{ k: 7, z: 8 }]) r.push(this.#a, this.#f);
      for (mk().#f of [9, 10]) r.push(this.#f);
      for (W.#s in { z: 1 }) r.push(W.#s);
      for (this.#o.k of [13]) r.push(this.#o.k);
      label: for (this.#f of [11, 12]) { if (this.#f === 11) continue label; r.push(this.#f); }
      return r;
    }
    nested() {
      const self = this;
      this.#f = 0;
      const arrow = () => this.#f++;
      function plain() { return ++self.#f; }
      class Inner {
        field = self.#f += 10;
        static { self.#f ??= "never"; }
        m(o, by = o.#f++) { return [by, o.#f--]; }
      }
      const obj = { get v() { return self.#f *= 2; }, [self.#f++]: 1 };
      return [arrow(), plain(), new Inner().field, new Inner().m(this), obj.v, Object.keys(obj)];
    }
    // A method and a getter alone cannot be written to, a setter alone cannot
    // be read, and \`foreign\` has none of the members.
    errors(foreign) {
      const before = n;
      const thrown = [
        caught(() => this.#m = 1), caught(() => this.#m++), caught(() => { [this.#m] = [1]; }),
        caught(() => this.#ro = 1), caught(() => this.#ro += 1), caught(() => { for (this.#ro of [1]); }),
        caught(() => this.#wo += 1), caught(() => this.#wo++), caught(() => this.#wo ??= 1),
        caught(() => foreign.#f++), caught(() => foreign.#f += 1), caught(() => foreign.#f ??= 1),
        caught(() => { [foreign.#f] = [1]; }), caught(() => { for (foreign.#a of [1]); }),
        caught(() => foreign.#f += (n++, 1)), caught(() => { [foreign.#f = (n++, 1)] = []; }),
      ];
      const typeErrors = thrown.every((name) => name === "TypeError") ? thrown.length : thrown;
      const self = () => this;
      return [typeErrors, typeof (this.#m ??= 1), (self().#m ??= 1) === this.#m, (self().#m ||= 1) === this.#m, n - before];
    }
    field = (this.#init += 1, this.#init++, [this.#init] = [this.#init * 2], this.#init);
    static { W.#s += 1; W.#s++; [W.#s] = [W.#s * 2]; }
    static initial = W.#s;
  }
  // Each form calls the functions the decorators of an accessor returned, as
  // often and in the order it would call a native getter and setter.
  const trace = [];
  const traced = (value, ctx) => ({
    get() { trace.push("get"); return value.get.call(this); },
    set(v) { trace.push("set:" + v); value.set.call(this, v); },
  });
  class T {
    @traced accessor #a = 1;
    run() {
      this.#a++;
      this.#a += 2;
      this.#a ??= 9;
      this.#a &&= 5;
      [this.#a] = [6];
      for (this.#a of [7]);
      return trace;
    }
  }
  const w = new W();
  w.other = new W();
  out.privateTargets = {
    accessorTrace: new T().run(),
    field: w.field,
    initial: W.initial,
    update: W.update(new W()),
    compound: w.compound(),
    logical: w.logical(),
    destructuring: w.destructuring(w.other),
    loopHeads: w.loopHeads(),
    nested: w.nested(),
    errors: w.errors({}),
    receiverEvals: n,
  };
}

// Other uses of a decorated \`#private\` member: optional chains, template
// tags, direct \`eval\` and \`import()\`. The expected values are what node
// prints for the same class without the decorators.
{
  class PU {
    n = 7;
    greet() { return "hi:" + this.n; }
    static greet() { return "static hi"; }
    @dec #f = function (s, ...v) { return this.n + ":" + s.raw.join("|") + v.join(","); };
    @dec #m(s, ...v) { return this.greet() + (s ? ":" + s.raw.join("|") + v.join(",") : ""); }
    @dec static #sm() { return this.greet(); }
    @dec accessor #a = "node:path";
    @dec #none;
    chains(o) { return [typeof o?.#f, o?.#m(), o?.#a.length, this?.#a, this.#m?.(), this.#none?.()]; }
    tags() { return [this.#f\`a\${1}b\`, this.#m\`c\${2}\`]; }
    evaluated() { return eval("[typeof this.#f, this.#m(), #a in this]"); }
    static evaluated() { return eval("this.#sm()"); }
    imported() { return import(this.#a).then((m) => typeof m.join); }
  }
  const pu = new PU();
  out.privateUses = [pu.chains(null), pu.chains(pu).slice(0, 3), pu.tags(), pu.evaluated(), PU.evaluated()];
  pending.push(pu.imported().then((v) => { out.privateImport = v; }));
}

// No instance field follows the member, so nothing can carry its initializer:
// it is still a field initializer. \`new.target\` is undefined, a constructor
// parameter does not shadow what it names, and it runs when \`super()\`
// returns, wherever that call is written. So do the extra initializers.
{
  const v = "outer";
  const seen = [];
  const see = (tag, target, value) => (seen.push(tag + ":" + typeof target + ":" + value), value);
  const extra = (value, ctx) => { ctx.addInitializer(function () { seen.push("extra " + String(ctx.name) + ":" + (this instanceof Base3)); }); };
  class Base3 {}
  const classes = [
    class { x = 0; accessor p = see("accessor", new.target, v); constructor(v) {} },
    class { accessor p = see("only accessor", new.target, v); },
    class { x = 0; @dec #p = see("#field", new.target, v); constructor(v) {} },
    class extends Base3 { @extra accessor p = see("decorated accessor", new.target, v); constructor(v) { const made = super(); } },
    class extends Base3 { @extra accessor #p = see("decorated #accessor", new.target, v); constructor(v) { if (v) { super(); } else { super(); } } },
    class extends Base3 { @extra p = see("decorated field", new.target, v); constructor(v) { (() => super())(); } },
    class extends Base3 { @extra m() {} constructor(v) { void super(); seen.push("body"); } },
    class extends Base3 { @extra p = see("never", new.target, v); constructor(v) { return { made: v }; } },
  ];
  for (const C of classes) {
    try { new C("parameter"); } catch (e) { seen.push(e.constructor.name); }
  }
  out.lastInstanceField = seen;
}

// The function or class an accessor is initialized with has the name of the
// accessor, not the name of the storage behind it.
{
  const k = "dyn", sym = Symbol("desc");
  class FN {
    accessor a = () => {};
    static accessor b = class {};
    accessor [k] = function () {};
    accessor [sym] = () => {};
    accessor "q r" = () => {};
    accessor c = function named() {};
    accessor d = (() => () => {})();
  }
  const fn = new FN();
  out.accessorFunctionNames = [fn.a.name, FN.b.name, fn[k].name, fn[sym].name, fn["q r"].name, fn.c.name, fn.d.name];
}

// The \`#private\` names the lowering adds for accessor storage differ from
// the names the class declares, from each other, and from a name of an
// enclosing class that the body refers to.
{
  class Outer2 {
    #x = "outer";
    static make() {
      return class {
        accessor x = "first";
        #x2 = "x2";
        accessor x = "second";
        @dec accessor #y = "y";
        #_y = "_y";
        read(o) { return [this.x, o.#x, this.#x2, this.#y, this.#_y]; }
      };
    }
  }
  out.addedPrivateNames = new (Outer2.make())().read(new Outer2());
}

// What follows the last instance field runs when \`super()\` returns,
// wherever that call is written, and not at all when it is never called.
{
  const seen = [];
  const see = (tag) => (seen.push(tag), tag);
  const extra = (value, ctx) => { ctx.addInitializer(function () { seen.push("extra " + String(ctx.name) + ":" + (this instanceof Base4)); }); };
  class Base4 {}
  const classes = [
    class extends Base4 { @extra accessor p = see("accessor"); constructor() { const made = super(); seen.push("body"); } },
    class extends Base4 { accessor p = see("plain accessor"); constructor(x) { if (x) { super(); } else { super(); } seen.push("body"); } },
    class extends Base4 { @extra #p = see("#field"); constructor() { (() => super())(); seen.push("body"); } },
    class extends Base4 { @extra accessor #p = see("#accessor"); constructor() { void super(); seen.push("body"); } },
    class extends Base4 { @extra p = see("field"); constructor() { const made = super(); seen.push("body"); } },
    class extends Base4 { @extra m() {} constructor() { const made = super(); seen.push("body"); } },
    class extends Base4 { @extra #m() {} constructor() { const made = super(); seen.push("body"); } },
    class extends Base4 { @extra p = see("never"); constructor() { return { made: true }; } },
    class extends Base4 { #_ = see("own #_"); @extra p = see("next to #_"); constructor() { const made = super(); seen.push(this.#_); } },
  ];
  for (const C of classes) {
    try { new C(1); } catch (e) { seen.push(e.constructor.name); }
  }
  out.superNotAStatement = seen;
}

// Every update and assignment form works on a decorated \`#private\` field,
// and \`context.access\` reaches it.
{
  let access, staticAccess;
  const grab = (value, ctx) => { if (ctx.static) staticAccess = ctx.access; else access = ctx.access; };
  class A {
    @grab #x = 1;
    @grab static #s = "s";
    run() {
      this.#x++;
      this.#x += 2;
      this.#x ??= 100;
      [this.#x] = [this.#x * 2];
      ({ a: this.#x = 3 } = { a: this.#x + 1 });
      for (this.#x of [this.#x + 1]) {}
      A.#s += "!";
      return [this?.#x, A.#s];
    }
  }
  const a = new A();
  const ran = a.run();
  access.set(a, access.get(a) + 1);
  const misses = [() => access.get({}), () => access.set({}, 1), () => access.has(1), () => staticAccess.get(a)].map((f) => {
    try { return f(); } catch (e) { return e.constructor.name; }
  });
  out.nativeField = [ran, access.get(a), access.has(a), access.has({}), staticAccess.get(A), staticAccess.has(a), misses];
}

// The lowered class names no global: the scope can declare \`WeakMap\`,
// \`WeakSet\` and \`Symbol\`.
{
  const WeakMap = 1, WeakSet = 2;
  let k = "k";
  class Symbol {}
  class A {
    @dec #x = 1;
    @dec accessor #a = 2;
    @dec accessor b = 3;
    accessor c = 4;
    @dec #m() { return 5; }
    @dec get #g() { return 6; }
    [k]() { return [this.#x, this.#a, this.b, this.c, this.#m(), this.#g]; }
  }
  const Named = class Symbol { @dec #m() { return Symbol === this.constructor; } [k]() { return this.#m(); } };
  out.declaredGlobals = [new A().k(), new Named().k(), Reflect.ownKeys(A.prototype).length, Reflect.ownKeys(Named.prototype).length];
}

// Each evaluation of a class has its own \`#private\` names and its own
// temporaries: a member of the class of the first iteration does not give
// what the decorators returned in the second one.
{
  const classes = [];
  const statements = [];
  for (const tag of ["a", "b"]) {
    const wrap = (value, ctx) => ctx.kind === "accessor" ? { get() { return value.get.call(this) + tag; } } : function () { return value.call(this) + tag; };
    classes.push(class {
      @dec #x = tag;
      @wrap accessor #acc = tag;
      @wrap #m() { return tag; }
      @wrap accessor pub = tag;
      @wrap get #g() { return tag; }
      static read(o) { try { return [o.#x, o.#acc, o.#m(), o.pub, o.#g, #x in o, #acc in o, #m in o]; } catch (e) { return e.constructor.name; } }
    });
    class Statement {
      @wrap accessor #acc = tag;
      @dec x = tag;
      read() { return [this.#acc, this.x]; }
    }
    statements.push(Statement);
  }
  const [A, B] = classes;
  out.eachEvaluation = [A.read(new A()), A.read(new B()), B.read(new B()), B.read(new A()), statements.map((C) => new C().read())];
}

// A class expression that runs more often than the statements around it: a
// parameter default, an instance field initializer, the test of a loop.
{
  const named = (value, ctx) => ctx.kind === "accessor" ? {} : value;
  function viaDefault(tag, K = class { @named accessor #x = tag; @named #m() { return tag; } read() { return [this.#x, this.#m()]; } }) { return K; }
  const defaults = [viaDefault("a"), viaDefault("b")];
  let current;
  class Outer {
    K = class { static tag = current; @named accessor #x = this.constructor.tag; @named y = this.constructor.tag; read() { return [this.#x, this.y]; } };
    L = @named class { @named accessor z = current; };
  }
  const fields = ["a", "b"].map((tag) => (current = tag, new Outer()));
  const heads = [];
  for (let i = 0, K; i < 2 && (K = class { @named accessor #x = i; read() { return this.#x; } }, heads.push(K)); i++);
  const nested = [];
  function viaNested(tag, K = class { static Inner = class { @named accessor #x = tag; read() { return this.#x; } }; }) { nested.push(K.Inner); }
  viaNested("a");
  viaNested("b");
  const self = { tag: "self" };
  const seen = [];
  const see = (self, args) => (seen.push(self.tag, args.length), named);
  function viaThis(K = class { @(see(this, arguments)) accessor #x = 1; [this.tag]() { return this.#x; } }) { return K; }
  out.evaluationPositions = {
    parameterDefault: defaults.map((K) => new K().read()),
    fieldInitializer: fields.map((o) => new o.K().read()),
    loopTest: heads.map((K) => new K().read()),
    nestedInDefault: nested.map((K) => new K().read()),
    names: [defaults[0].name, fields[0].K.name, fields[0].L.name],
    outerThis: [new (viaThis.call(self))().self(), seen],
  };
}

// More of those positions. Each decorated class gets a number that its
// instances receive through \`addInitializer\`, and an accessor that keeps its
// value.
{
  let evaluations = 0;
  const id = (value, ctx) => {
    const n = ++evaluations;
    ctx.addInitializer(function () { this.id = n; });
  };
  const report = (K1, K2) => {
    const a = new K1(), b = new K2();
    a.x += "!";
    return [K1 !== K2, a.id, b.id, a.x, b.x];
  };
  const arrow = (K = class { @id accessor x = "x" }) => K;
  class Factory {
    constructor(K = class { @id accessor x = "x" }) { this.K = K; }
    make(K = class { @id accessor x = "x" }) { return K; }
  }
  function destructured({ K = class { @id accessor x = "x" } } = {}) { return K; }
  class Lowered { accessor inner = class { @id accessor x = "x" }; }
  const seen = [];
  const tagged = (tag) => (value, ctx) => { seen.push(tag + ":" + ctx.name); };
  class TagBase { baseTag() { return "super"; } }
  class Tagged extends TagBase {
    tag = "this";
    inner = class {
      @tagged(this.tag) accessor viaThis = 1;
      @tagged(super.baseTag()) accessor viaSuper = 2;
    };
  }
  const inner = new (new Tagged().inner)();
  const factories = [new Factory(), new Factory()];
  out.morePositions = [
    report(arrow(), arrow()),
    report(factories[0].K, factories[1].K),
    report(factories[0].make(), factories[1].make()),
    report(destructured(), destructured()),
    report(new Lowered().inner, new Lowered().inner),
    [seen, inner.viaThis, inner.viaSuper],
  ];
}

// In the body of a loop: a class decorator with an \`extends\` clause, a
// computed key, a static initializer, a block and the cases of a \`switch\`.
{
  const replace = (C, ctx) => class extends C { replaced = true; };
  const made = [];
  class LoopBase { base = "base"; }
  for (const tag of ["a", "b"]) {
    @replace class Decorated extends LoopBase { @dec x = tag; }
    const Keyed = class { @dec [tag + "Key"] = tag; static Nested = class { @dec accessor y = tag; }; };
    let InBlock, InSwitch;
    { InBlock = class { @dec accessor z = tag; }; }
    switch (tag) {
      case "a": InSwitch = class { @dec accessor w = tag + 1; }; break;
      default: InSwitch = class { @dec accessor w = tag + 2; };
    }
    made.push([Decorated, Keyed, InBlock, InSwitch]);
  }
  out.loopBody = made.map(([Decorated, Keyed, InBlock, InSwitch]) => {
    const d = new Decorated(), k = new Keyed();
    return [d.x, d.base, d.replaced, Object.keys(k).join(), Object.values(k).join(), new Keyed.Nested().y, new InBlock().z, new InSwitch().w];
  });
}

// A decorated \`accessor #p\` is on the object before its first initializer.
{
  class D { a = #p in this; @dec accessor #p = 1; b = [#p in this, this.#p]; }
  class S { static a = #p in this; @dec static accessor #p = 1; static b = [#p in this, this.#p]; }
  const d = new D();
  out.accessorBrand = [d.a, d.b, S.a, S.b];
}

// What the decorators of a \`#private\` member get: its functions, and an
// access object that reads and writes it.
{
  const seen = {};
  const grab = (value, ctx) => {
    seen[(ctx.static ? "static " : "") + ctx.kind] = {
      ctx,
      value: typeof value === "function" ? value.name : value && [value.get.name, value.set.name],
    };
  };
  const double = (value, ctx) => {
    switch (ctx.kind) {
      case "method": return function twice() { return value.call(this) * 2; };
      case "getter": return function () { return value.call(this) * 2; };
      case "setter": return function (v) { value.call(this, v * 2); };
      case "accessor": return { get() { return value.get.call(this) * 2; }, set(v) { value.set.call(this, v * 2); }, init: (v) => v * 2 };
      case "field": return (v) => v * 2;
    }
  };
  class A {
    @double @grab #field = 1;
    @double @grab accessor #accessor = 1;
    @double @grab #method() { return this.#v; }
    #v = 1;
    @double @grab get #pair() { return this.#v; }
    @double @grab set #pair(v) { this.#v = v; }
    @double @grab static #shared() { return 21; }
    static names = [A.#shared.name, typeof A.#shared];
    names() { return [this.#method.name, this.#method === this.#method]; }
  }
  const a = new A();
  const { field, accessor, method, getter, setter, "static method": staticMethod } = seen;
  const result = {
    values: [field.value ?? null, accessor.value, method.value, getter.value, setter.value, staticMethod.value],
    keys: Object.values(seen).map(({ ctx }) => [ctx.name, ctx.private, ctx.static, Object.keys(ctx.access).join()]),
    has: Object.values(seen).map(({ ctx }) => [ctx.access.has(a), ctx.access.has(A), ctx.access.has({})]),
    read: [field.ctx.access.get(a), accessor.ctx.access.get(a), method.ctx.access.get(a).call(a), getter.ctx.access.get(a), staticMethod.ctx.access.get(A)()],
    names: [a.names(), A.names],
  };
  field.ctx.access.set(a, 10);
  accessor.ctx.access.set(a, 10);
  setter.ctx.access.set(a, 10);
  result.written = [field.ctx.access.get(a), accessor.ctx.access.get(a), getter.ctx.access.get(a)];
  result.misses = [() => field.ctx.access.get({}), () => accessor.ctx.access.set({}, 1), () => method.ctx.access.get(A), () => getter.ctx.access.get({}), () => setter.ctx.access.set({}, 1), () => field.ctx.access.has(1)].map((f) => {
    try { return f(); } catch (e) { return e.constructor.name; }
  });
  out.decoratorValues = result;
}

// \`Bun.deepMatch\` sees the value of an accessor as it sees a \`#private\` field.
{
  class Accessor { accessor x; constructor(x) { this.x = x; } }
  class Decorated { @dec accessor x; constructor(x) { this.x = x; } }
  class Field { #x; constructor(x) { this.#x = x; } }
  out.deepMatch = [Accessor, Decorated, Field].map((C) => [Bun.deepMatch(new C(1), new C(1)), Bun.deepMatch(new C(1), new C(2))]);
}

// An accessor with the key \`constructor\`.
{
  class A { accessor ["constructor"] = 1; }
  class B { static accessor ["constructor"] = 2; }
  out.constructorKey = [new A().constructor, B.constructor];
}

// A derived constructor without a \`super();\` statement: what follows the
// last field rides in one more \`#private\` field. The class, and a class
// around it that the body refers to, already use the names it would take.
{
  const ran = (v, ctx) => { ctx.addInitializer(function () { this.ran = true; }); };
  class Base5 {}
  class Outer3 {
    #_ = "outer";
    static make() {
      return class extends Base5 {
        #_2 = "own";
        @ran x = "x";
        constructor() { const made = super(); }
        read(o) { return [o.#_, this.#_2, this.x, this.ran]; }
      };
    }
  }
  out.tailFieldName = new (Outer3.make())().read(new Outer3());
}
`;

const memberExpected = {
  privateTargets: {
    accessorTrace: ["get", "set:2", "get", "set:4", "get", "get", "set:5", "set:6", "set:7"],
    field: 6,
    initial: 6,
    update: [6, 6, 7, 5, 5, "1", "3", 1, 3, 10, 8, 6, 8, 8, 5, 4, 8, 6, 4, 9, 1, 2, "number", -6, null, 7, 0, 1, 2],
    compound: [9, 8, 24, 12, 5, 25, 100, 50, 25, 25, 8, 13, "13s", "3", 6, 7, 70, "13st", 5, 14, 6, 4, 6, 6],
    logical: ["a", "a", "a", "d", "d", 2, 2, 0, 0, 0, 0, 0, 0, 6, 6, 6, 2, null, "e", "e", 9, 2, "g", "h", "g", 1110],
    destructuring: [2, 1, 3, 4, 5, 6, 7, 8, 9, 13, [11, 12], { "x": 14 }, 13, 15, 16, 17, 18, 19, 1, 20, [21, 21]],
    loopHeads: [1, 2, "x", "y", 4, 3, 5, 6, 7, { "z": 8 }, 9, 10, "z", 13, 12],
    nested: [1, 3, 13, [23, 24], 46, ["0", "v"]],
    errors: [16, "function", true, true, 1],
    receiverEvals: 1115,
  },
  privateUses: [
    ["undefined", null, null, "node:path", "hi:7", null],
    ["function", "hi:7", 9],
    ["7:a|b1", "hi:7:c|2"],
    ["function", "hi:7", true],
    "static hi",
  ],
  privateImport: "function",
  lastInstanceField: [
    "accessor:undefined:outer",
    "only accessor:undefined:outer",
    "#field:undefined:outer",
    "decorated accessor:undefined:outer",
    "extra p:true",
    "decorated #accessor:undefined:outer",
    "extra #p:true",
    "decorated field:undefined:outer",
    "extra p:true",
    "extra m:true",
    "body",
  ],
  accessorFunctionNames: ["a", "b", "dyn", "[desc]", "q r", "named", ""],
  addedPrivateNames: ["second", "outer", "x2", "y", "_y"],
  superNotAStatement: [
    "accessor",
    "extra p:true",
    "body",
    "plain accessor",
    "body",
    "#field",
    "extra #p:true",
    "body",
    "#accessor",
    "extra #p:true",
    "body",
    "field",
    "extra p:true",
    "body",
    "extra m:true",
    "body",
    "extra #m:true",
    "body",
    "own #_",
    "next to #_",
    "extra p:true",
    "own #_",
  ],
  nativeField: [[10, "s!"], 11, true, false, "s!", false, ["TypeError", "TypeError", "TypeError", "TypeError"]],
  declaredGlobals: [[1, 2, 3, 4, 5, 6], true, 4, 2],
  eachEvaluation: [
    ["a", "aa", "aa", "aa", "aa", true, true, true],
    "TypeError",
    ["b", "bb", "bb", "bb", "bb", true, true, true],
    "TypeError",
    [
      ["aa", "a"],
      ["bb", "b"],
    ],
  ],
  evaluationPositions: {
    parameterDefault: [
      ["a", "a"],
      ["b", "b"],
    ],
    fieldInitializer: [
      ["a", "a"],
      ["b", "b"],
    ],
    loopTest: [0, 1],
    nestedInDefault: ["a", "b"],
    names: ["K", "K", "L"],
    outerThis: [1, ["self", 0]],
  },
  morePositions: [
    [true, 3, 4, "x!", "x"],
    [true, 1, 2, "x!", "x"],
    [true, 5, 6, "x!", "x"],
    [true, 7, 8, "x!", "x"],
    [true, 9, 10, "x!", "x"],
    [["this:viaThis", "super:viaSuper"], 1, 2],
  ],
  loopBody: [
    ["a", "base", true, "aKey", "a", "a", "a", "a1"],
    ["b", "base", true, "bKey", "b", "b", "b", "b2"],
  ],
  accessorBrand: [true, [true, 1], true, [true, 1]],
  decoratorValues: {
    values: [null, ["get #accessor", "set #accessor"], "#method", "get #pair", "set #pair", "#shared"],
    // Static methods first, then methods and accessors, then fields.
    keys: [
      ["#shared", true, true, "has,get"],
      ["#accessor", true, false, "has,get,set"],
      ["#method", true, false, "has,get"],
      ["#pair", true, false, "has,get"],
      ["#pair", true, false, "has,set"],
      ["#field", true, false, "has,get,set"],
    ],
    has: [
      [false, true, false],
      [true, false, false],
      [true, false, false],
      [true, false, false],
      [true, false, false],
      [true, false, false],
    ],
    read: [2, 4, 2, 2, 42],
    names: [
      ["twice", true],
      ["twice", "function"],
    ],
    written: [10, 40, 40],
    misses: ["TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError"],
  },
  deepMatch: [
    [true, false],
    [true, false],
    [true, false],
  ],
  constructorKey: [1, 2],
  tailFieldName: ["outer", "own", "x", true],
};

const fixtureEnd = `\nPromise.all(pending).then(() => console.log(JSON.stringify(out)));\n`;

function buildFixture() {
  let src = fixturePrelude;
  for (const cell of cells) {
    src += matrixClass(cell);
  }
  src += installSection;
  src += extraSections;
  src += fixtureEnd;
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

// Runs a fixture once per mode.
async function runMode(mode: Mode, fixture: string) {
  using dir = tempDir("es-dec-matrix", {
    [mode.file]: fixture,
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

const matrixRuns = await Promise.all(modes.map(mode => runMode(mode, buildFixture())));
const memberRuns = await Promise.all(modes.map(mode => runMode(mode, fixturePrelude + memberSections + fixtureEnd)));

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

describe("ES decorators: members of the class", () => {
  modes.forEach((mode, i) => {
    describe(mode.name, () => {
      const { out, stderr, exitCode } = memberRuns[i];

      test("the fixture runs", () => {
        expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
        expect(Object.keys(out).sort()).toEqual(Object.keys(memberExpected).sort());
      });

      for (const [key, expected] of Object.entries(memberExpected)) {
        test(key, () => {
          expect(out[key]).toEqual(expected);
        });
      }
    });
  });
});

// One module for each use of a decorated `#private` member, so that a use the
// lowering gets wrong fails alone. Each runs without the decorators, then with
// them, and gives the same value.
const privateUses: Record<string, [members: string, body: string, expected: unknown]> = {
  "this.#x": ["@dec #x = 1;", "return this.#x", 1],
  "this.#x = 7": ["@dec #x = 1;", "this.#x = 7; return this.#x", 7],
  "this.#x++": ["@dec #x = 1;", "return [this.#x++, this.#x]", [1, 2]],
  "++this.#x": ["@dec #x = 1;", "return [++this.#x, this.#x]", [2, 2]],
  "this.#x += 2": ["@dec #x = 1;", "return [(this.#x += 2), this.#x]", [3, 3]],
  "this.#x ??= 5": ["@dec #x = null;", "return [(this.#x ??= 5), this.#x]", [5, 5]],
  "this.#x ||= 5": ["@dec #x = 0;", "return [(this.#x ||= 5), this.#x]", [5, 5]],
  "this.#x &&= 5": ["@dec #x = 1;", "return [(this.#x &&= 5), this.#x]", [5, 5]],
  "[this.#x] = [5]": ["@dec #x = 1;", "[this.#x] = [5]; return this.#x", 5],
  "[this.#x = 3] = []": ["@dec #x = 1;", "[this.#x = 3] = []; return this.#x", 3],
  "({ a: this.#x } = { a: 6 })": ["@dec #x = 1;", "({ a: this.#x } = { a: 6 }); return this.#x", 6],
  "for (this.#x of [1, 2, 3])": ["@dec #x = 0;", "for (this.#x of [1, 2, 3]); return this.#x", 3],
  "for (this.#x in { k: 1 })": ["@dec #x = 0;", "for (this.#x in { k: 1 }); return this.#x", "k"],
  "o?.#x": ["@dec #x = 1;", "const o = null; return [o?.#x === undefined, this?.#x]", [true, 1]],
  "o?.#m()": ["@dec #m() { return 1; }", "const o = null; return [o?.#m() === undefined, this?.#m()]", [true, 1]],
  "this.#x?.()": ["@dec #x = null;", "return this.#x?.() === undefined", true],
  "this.#x`t`": [
    "@dec #x = function (s) { return [s[0], this === self]; };",
    "self = this; return this.#x`t`",
    ["t", true],
  ],
  "this.#m`t`": ["@dec #m(s) { return [s[0], this === self]; }", "self = this; return this.#m`t`", ["t", true]],
  "this.#x()": ["@dec #x = function () { return this === self; };", "self = this; return this.#x()", true],
  "#x in o": ["@dec #x = 1;", "return [#x in this, #x in {}]", [true, false]],
  "typeof this.#x": ["@dec #x = 1;", "return typeof this.#x", "number"],
  "import(this.#x)": ['@dec #x = "node:path";', "return import(this.#x).then((m) => typeof m.join)", "function"],
  'eval("this.#x")': ["@dec #x = 1;", 'return eval("this.#x")', 1],
  "static #x++": ["@dec static #x = 1;", "return [A.#x++, A.#x]", [1, 2]],
  "accessor #x++": ["@dec accessor #x = 1;", "return [this.#x++, this.#x]", [1, 2]],
  "static accessor #x += 2": ["@dec static accessor #x = 1;", "return [(A.#x += 2), A.#x]", [3, 3]],
  "get #x() and set #x(v)": [
    "#v = 1; @dec get #x() { return this.#v; } @dec set #x(v) { this.#v = v; }",
    "return [this.#x++, (this.#x += 2), this.#x]",
    [1, 4, 4],
  ],
};

async function runPrivateUses() {
  const files: Record<string, string> = {};
  const modules: Record<string, string[]> = {};
  Object.entries(privateUses).forEach(([name, [members, body]], i) => {
    modules[name] = ["", "@dec "].map((decorator, j) => {
      const file = `use-${i}-${j}.js`;
      files[file] = `
        let self;
        const dec = (value, ctx) => value;
        class Base { greet() { return "hi"; } }
        class A extends Base { ${members.replaceAll("@dec ", decorator)} run() { ${body} } }
        export default await new A().run();
      `;
      return file;
    });
  });
  files["main.js"] = `
    const out = {};
    for (const [name, files] of Object.entries(${JSON.stringify(modules)})) {
      out[name] = [];
      for (const file of files) {
        try {
          out[name].push((await import("./" + file)).default);
        } catch (e) {
          out[name].push("threw " + e.name);
        }
      }
    }
    console.log(JSON.stringify(out));
  `;
  using dir = tempDir("es-dec-private-uses", files);
  const { stdout, stderr, exitCode } = await runIn(String(dir), ["main.js"]);
  return { out: exitCode === 0 ? JSON.parse(stdout) : {}, stderr: filterStderr(stderr), exitCode };
}

const privateUseRuns = await runPrivateUses();

describe("uses of a decorated #private member", () => {
  test("the fixture runs", () => {
    expect({ stderr: privateUseRuns.stderr, exitCode: privateUseRuns.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  });

  for (const [name, [, , expected]] of Object.entries(privateUses)) {
    test(name, () => {
      expect(privateUseRuns.out[name]).toEqual([expected, expected]);
    });
  }
});
