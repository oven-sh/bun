import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("ECMAScript Decorators", () => {
  test("class decorators - basic", async () => {
    using dir = tempDir("decorator-test", {
      "test.js": `
        let decoratorCalled = false;
        let originalClass;

        function decorator(cls, ctx) {
          decoratorCalled = true;
          originalClass = cls;
          console.log("decorator called:", ctx.kind, ctx.name);
        }

        @decorator
        class Foo {
          value = 42;
        }

        console.log("decoratorCalled:", decoratorCalled);
        console.log("same class:", Foo === originalClass);
        console.log("instance value:", new Foo().value);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("decorator called: class Foo");
    expect(stdout).toContain("decoratorCalled: true");
    expect(stdout).toContain("same class: true");
    expect(stdout).toContain("instance value: 42");
  });

  test("method decorators", async () => {
    using dir = tempDir("decorator-test", {
      "test.js": `
        function logMethod(fn, ctx) {
          console.log("decorating method:", ctx.kind, ctx.name);
          return function(...args) {
            console.log("calling method:", ctx.name, "with args:", args);
            return fn.apply(this, args);
          }
        }

        class Calculator {
          @logMethod
          add(a, b) {
            return a + b;
          }
        }

        const calc = new Calculator();
        console.log("result:", calc.add(2, 3));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("decorating method: method add");
    expect(stdout).toContain("calling method: add with args: [2,3]");
    expect(stdout).toContain("result: 5");
  });

  test("field decorators", async () => {
    using dir = tempDir("decorator-test", {
      "test.js": `
        function defaultValue(value) {
          return function(target, ctx) {
            console.log("decorating field:", ctx.kind, ctx.name);
            return function(initialValue) {
              return initialValue ?? value;
            }
          }
        }

        class Config {
          @defaultValue("default")
          name;

          @defaultValue(100)
          timeout;
        }

        const config = new Config();
        console.log("name:", config.name);
        console.log("timeout:", config.timeout);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("decorating field: field name");
    expect(stdout).toContain("decorating field: field timeout");
    expect(stdout).toContain("name: default");
    expect(stdout).toContain("timeout: 100");
  });

  test("accessor decorators", async () => {
    using dir = tempDir("decorator-test", {
      "test.js": `
        function logged(accessor, ctx) {
          const { get, set } = accessor;
          console.log("decorating accessor:", ctx.kind, ctx.name);

          return {
            get() {
              const value = get.call(this);
              console.log("getting", ctx.name, ":", value);
              return value;
            },
            set(value) {
              console.log("setting", ctx.name, "to:", value);
              set.call(this, value);
            }
          };
        }

        class State {
          @logged
          accessor value = 42;
        }

        const state = new State();
        console.log("initial:", state.value);
        state.value = 100;
        console.log("updated:", state.value);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("decorating accessor: accessor value");
    expect(stdout).toContain("getting value : 42");
    expect(stdout).toContain("setting value to: 100");
    expect(stdout).toContain("getting value : 100");
  });

  test("multiple decorators", async () => {
    using dir = tempDir("decorator-test", {
      "test.js": `
        function first(cls, ctx) {
          console.log("first decorator");
          return class extends cls {
            firstAdded = true;
          };
        }

        function second(cls, ctx) {
          console.log("second decorator");
          return class extends cls {
            secondAdded = true;
          };
        }

        @first
        @second
        class MyClass {
          original = true;
        }

        const instance = new MyClass();
        console.log("original:", instance.original);
        console.log("firstAdded:", instance.firstAdded);
        console.log("secondAdded:", instance.secondAdded);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("second decorator");
    expect(stdout).toContain("first decorator");
    expect(stdout).toContain("original: true");
    expect(stdout).toContain("firstAdded: true");
    expect(stdout).toContain("secondAdded: true");
  });

  test("decorator metadata", async () => {
    using dir = tempDir("decorator-test", {
      "test.js": `
        // Polyfill Symbol.metadata if not available
        if (!('metadata' in Symbol)) {
          Symbol.metadata = Symbol('Symbol.metadata');
        }
        if (!(Symbol.metadata in Function)) {
          Object.defineProperty(Function.prototype, Symbol.metadata, { value: null });
        }

        function addMetadata(key, value) {
          return function(target, ctx) {
            ctx.metadata[key] = value;
          }
        }

        @addMetadata("type", "component")
        class MyComponent {
          @addMetadata("type", "property")
          name = "Component";

          @addMetadata("type", "method")
          render() {}
        }

        const metadata = MyComponent[Symbol.metadata];
        console.log("class metadata type:", metadata?.type);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("class metadata type: component");
  });

  test("tsconfig experimentalDecorators vs standard decorators", async () => {
    using dir = tempDir("decorator-test", {
      "tsconfig.json": `{
        "compilerOptions": {
          "experimentalDecorators": false
        }
      }`,
      "test.ts": `
        // This should use standard ECMAScript decorators, not TypeScript experimental
        function decorator(cls: any, ctx: any) {
          console.log("Standard decorator context:", ctx.kind);
        }

        @decorator
        class Foo {}
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Standard decorator context: class");
  });

  test("tsconfig with experimental decorators enabled", async () => {
    using dir = tempDir("decorator-test", {
      "tsconfig.json": `{
        "compilerOptions": {
          "experimentalDecorators": true
        }
      }`,
      "test.ts": `
        // This should use TypeScript experimental decorators
        function decorator(target: any) {
          console.log("Experimental decorator target:", target.name);
        }

        @decorator
        class Foo {}
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Experimental decorator target: Foo");
  });
});
