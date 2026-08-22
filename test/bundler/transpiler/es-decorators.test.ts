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

  // A class decorator that returns a replacement class rebinds the class name
  // inside the class body too (tsc: `_classThis`), and the class's static
  // fields are initialized afterwards, on the replacement.
  describe.concurrent("class body observes the class returned by a class decorator", () => {
    const wrap = `
      function wrap(cls, ctx) {
        return class Wrapped extends cls { static tag = "wrapped"; };
      }
      const tag = x => x.tag ?? "original";
    `;

    test("methods, getters, instance fields and static fields see the replacement", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        ${wrap}
        @wrap class Foo {
          static create() { return new Foo(); }
          static self = Foo;
          static viaThis = this;
          static tagWhenInitialized = String(Foo.tag);
          whoAmI() { return Foo; }
          get ctor() { return Foo; }
          field = Foo;
        }
        console.log(JSON.stringify({
          outer: tag(Foo),
          create: tag(Foo.create().constructor),
          whoAmI: tag(new Foo().whoAmI()),
          getter: tag(new Foo().ctor),
          field: tag(new Foo().field),
          self: tag(Foo.self),
          viaThis: tag(Foo.viaThis),
          tagWhenInitialized: Foo.tagWhenInitialized,
        }));
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        outer: "wrapped",
        create: "wrapped",
        whoAmI: "wrapped",
        getter: "wrapped",
        field: "wrapped",
        self: "wrapped",
        viaThis: "wrapped",
        tagWhenInitialized: "wrapped",
      });
      expect(exitCode).toBe(0);
    });

    test("static fields are initialized after the class decorator, in order, on the replacement", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const log = [];
        let original;
        function wrap(cls, ctx) {
          log.push("decorator");
          original = cls;
          return class Wrapped extends cls {};
        }
        const receivers = [];
        @wrap class Foo {
          static a = (log.push("a"), 1);
          static { log.push("static block"); }
          static b = (receivers.push(this), 2);
          static c;
        }
        log.push("after class");
        console.log(JSON.stringify({
          log,
          ownKeys: Object.keys(Foo),
          originalKeys: Object.keys(original),
          receiverIsReplacement: receivers[0] === Foo && receivers[0] !== original,
          values: [Foo.a, Foo.b, Foo.c],
        }));
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        log: ["decorator", "a", "static block", "after class"],
        ownKeys: ["a", "b", "c"],
        originalKeys: [],
        receiverIsReplacement: true,
        values: [1, 2, null],
      });
      expect(exitCode).toBe(0);
    });

    test("relocated static fields keep their keys, evaluated once and in source order", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        ${wrap}
        const log = [];
        const key = name => (log.push(name), name);
        const methodDec = () => {
          log.push("decorator expression");
          return (fn, ctx) => { log.push("decorator applied"); };
        };
        @wrap class Foo {
          static [key("first")] = 1;
          @methodDec() method() {}
          [key("instance field")] = 0;
          static [key("second")] = 2;
          [key("instance method")]() {}
          static 0 = "zero";
          static "quoted key" = "quoted";
        }
        console.log(JSON.stringify([
          log,
          Object.keys(Foo),
          Object.keys(new Foo()),
          typeof Foo.prototype["instance method"],
          Foo.first,
          Foo.second,
          Foo[0],
          Foo["quoted key"],
        ]));
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        ["first", "decorator expression", "instance field", "second", "instance method", "decorator applied"],
        // "tag" is Wrapped's own static field; the relocated fields follow it.
        ["0", "tag", "first", "second", "quoted key"],
        ["instance field"],
        "function",
        1,
        2,
        "zero",
        "quoted",
      ]);
      expect(exitCode).toBe(0);
    });

    test("an initializer that only works inside the class body keeps every static field there, in order", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const log = [];
        let original;
        function wrap(cls, ctx) {
          log.push("decorator");
          original = cls;
          return class Wrapped extends cls {};
        }
        class Base {
          static defaults = { limit: 10 };
        }
        @wrap class Foo extends Base {
          static first = (log.push("first"), 1);
          static fromSuper = (log.push("fromSuper"), { ...super.defaults, limit: 20 });
          static second = (log.push("second"), Foo.first + 1);
          static newTarget = new.target;
          static thisInParameter = (value = this) => value;
          static thisInComputedKey = { [this.name]: true };
          static create = () => new Foo();
        }
        console.log(JSON.stringify({
          log,
          originalKeys: Object.keys(original),
          replacementKeys: Object.keys(Foo),
          fromSuper: Foo.fromSuper,
          second: Foo.second,
          newTarget: typeof Foo.newTarget,
          thisInParameter: Foo.thisInParameter() === original,
          thisInComputedKey: Foo.thisInComputedKey,
          created: Foo.create() instanceof Foo,
        }));
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        log: ["first", "fromSuper", "second", "decorator"],
        originalKeys: ["first", "fromSuper", "second", "newTarget", "thisInParameter", "thisInComputedKey", "create"],
        replacementKeys: [],
        fromSuper: { limit: 20 },
        second: 2,
        newTarget: "undefined",
        thisInParameter: true,
        thisInComputedKey: { Foo: true },
        // Lazy initializers still pick up the decorated class through the body's binding.
        created: true,
      });
      expect(exitCode).toBe(0);
    });

    test("eagerly evaluated initializers of every common shape are relocated together", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        let original;
        function wrap(cls, ctx) {
          original = cls;
          return class Wrapped extends cls {};
        }
        const label = "label";
        @wrap class Foo {
          static singleton = new Foo();
          static registry = new Map([[label, Foo]]);
          static config = { self: Foo, owner: this, nested: [1, ...[2], \`\${label}:\${Foo.name}\`], ...{ extra: true } };
          static flag = typeof Foo === "function" && this === Foo ? "decorated" : "undecorated";
          static declaredOnly;
        }
        console.log(JSON.stringify({
          originalKeys: Object.keys(original),
          replacementKeys: Object.keys(Foo),
          singleton: Foo.singleton instanceof Foo,
          registry: Foo.registry.get("label") === Foo,
          config: [Foo.config.self === Foo, Foo.config.owner === Foo, Foo.config.nested, Foo.config.extra],
          flag: Foo.flag,
          declaredOnly: Object.hasOwn(Foo, "declaredOnly") && Foo.declaredOnly === undefined,
        }));
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        originalKeys: [],
        replacementKeys: ["singleton", "registry", "config", "flag", "declaredOnly"],
        singleton: true,
        registry: true,
        config: [true, true, [1, 2, "label:Wrapped"], true],
        flag: "decorated",
        declaredOnly: true,
      });
      expect(exitCode).toBe(0);
    });

    test("a computed key that cannot be pre-evaluated keeps every static field in place", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        let original;
        function wrap(cls, ctx) {
          original = cls;
          return class Wrapped extends cls {};
        }
        const log = [];
        const key = name => (log.push(name), name);
        @wrap class Foo {
          static [key("first")] = 1;
          [key("instance")] = 2;
          static [(() => key("second"))()] = 3;
        }
        console.log(JSON.stringify([log, Object.keys(Foo), Object.keys(original)]));
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([["first", "instance", "second"], [], ["first", "second"]]);
      expect(exitCode).toBe(0);
    });

    test("a private static field or a static accessor keeps every static field in place", async () => {
      // Neither is initialized through the ordered part of the lowering, so
      // relocating their siblings would move those out from under them.
      const { stdout, stderr, exitCode } = await runDecorator(`
        const log = [];
        let original;
        function wrap(cls, ctx) {
          log.push("decorator");
          original = cls;
          return class Wrapped extends cls {};
        }
        function keep(cls, ctx) {
          log.push("decorator");
        }
        @wrap class WithPrivate {
          static first = (log.push("first"), 1);
          static #second = (log.push("second"), WithPrivate.first + 1);
          static get second() { return WithPrivate.#second; }
        }
        const withPrivate = {
          log: log.splice(0),
          second: WithPrivate.second,
          originalKeys: Object.keys(original),
          replacementKeys: Object.keys(WithPrivate),
        };
        @keep class WithAccessor {
          static first = (log.push("first"), 1);
          static accessor second = (log.push("second"), 2);
          static third = (log.push("third"), WithAccessor.first + 2);
        }
        const withAccessor = {
          log: log.splice(0),
          values: [WithAccessor.first, WithAccessor.second, WithAccessor.third],
          keys: Object.keys(WithAccessor),
        };
        const Expression = @wrap class {
          static first = (log.push("first"), 1);
          static #second = (log.push("second"), this.first + 1);
          static get second() { return original.#second; }
        };
        const expression = {
          log: log.splice(0),
          second: Expression.second,
          originalKeys: Object.keys(original),
          replacementKeys: Object.keys(Expression),
        };
        console.log(JSON.stringify({ withPrivate, withAccessor, expression }));
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        withPrivate: {
          log: ["first", "second", "decorator"],
          second: 2,
          originalKeys: ["first"],
          replacementKeys: [],
        },
        withAccessor: {
          // The accessor's storage is set up by the lowering after the body runs; unchanged by this change.
          log: ["first", "third", "second", "decorator"],
          values: [1, 2, 3],
          keys: ["first", "third"],
        },
        expression: {
          log: ["first", "second", "decorator"],
          second: 2,
          originalKeys: ["first"],
          replacementKeys: [],
        },
      });
      expect(exitCode).toBe(0);
    });

    test("relocated static fields define properties instead of invoking inherited setters", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        ${wrap}
        const setterCalls = [];
        class Base {
          static set limit(value) { setterCalls.push(value); }
        }
        @wrap class Foo extends Base {
          static limit = 10;
        }
        console.log(JSON.stringify([setterCalls, Object.getOwnPropertyDescriptor(Foo, "limit")]));
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([[], { value: 10, writable: true, enumerable: true, configurable: true }]);
      expect(exitCode).toBe(0);
    });

    test("each evaluation of a class statement gets its own binding", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        ${wrap}
        function make() {
          @wrap class Foo {
            static create() { return new Foo(); }
          }
          return Foo;
        }
        const first = make();
        const second = make();
        const fromLoop = [];
        for (let i = 0; i < 2; i++) {
          @wrap class Bar {
            static create() { return new Bar(); }
          }
          fromLoop.push(Bar);
        }
        console.log(JSON.stringify([
          first.create() instanceof first,
          second.create() instanceof second,
          first.create() instanceof second,
          fromLoop[0].create() instanceof fromLoop[0],
          fromLoop[0].create() instanceof fromLoop[1],
        ]));
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([true, true, false, true, false]);
      expect(exitCode).toBe(0);
    });

    test("heritage, element decorator and computed key expressions see the TDZ, then the decorated class", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        ${wrap}
        const captured = [];
        function capture(fn) {
          let threw = "did not throw";
          try { fn(); } catch (e) { threw = e.constructor.name; }
          captured.push({ fn, threw });
          return () => {};
        }
        class Base {}
        @wrap class Foo extends (capture(() => Foo), Base) {
          @(capture(() => Foo)) method() {}
          @(capture(() => Foo)) static [(capture(() => Foo), "computed")]() {}
        }
        // Relocating Bar's static field pre-evaluates every computed key, so
        // the undecorated method's key still observes the TDZ too.
        let undecoratedKey = "did not throw";
        try {
          @wrap class Bar {
            [String(Bar)]() {}
            static field = 1;
          }
        } catch (e) {
          undecoratedKey = e.constructor.name;
        }
        console.log(JSON.stringify({
          captured: captured.map(({ fn, threw }) => [threw, tag(fn())]),
          undecoratedKey,
        }));
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        captured: [
          ["ReferenceError", "wrapped"],
          ["ReferenceError", "wrapped"],
          ["ReferenceError", "wrapped"],
          ["ReferenceError", "wrapped"],
        ],
        undecoratedKey: "ReferenceError",
      });
      expect(exitCode).toBe(0);
    });

    test("instance private members: the body sees the replacement; initializers naming them stay put", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        const originals = [];
        function wrap(cls, ctx) {
          originals.push(cls);
          return class Wrapped extends cls {};
        }
        @wrap class UsesPrivateNames {
          #secret = 42;
          static create() { return new UsesPrivateNames(); }
          static peek = foo => foo.#secret;
          static hasSecret = #secret in UsesPrivateNames;
          static self = UsesPrivateNames;
        }
        @wrap class PlainInitializers {
          #secret = 42;
          static create() { return new PlainInitializers(); }
          static self = PlainInitializers;
          reveal() { return this.#secret; }
        }
        console.log(JSON.stringify({
          usesPrivateNames: [
            UsesPrivateNames.create() instanceof UsesPrivateNames,
            UsesPrivateNames.peek(UsesPrivateNames.create()),
            UsesPrivateNames.hasSecret,
            Object.keys(originals[0]),
            Object.keys(UsesPrivateNames),
            UsesPrivateNames.self === originals[0],
          ],
          plainInitializers: [
            PlainInitializers.create() instanceof PlainInitializers,
            PlainInitializers.create().reveal(),
            Object.keys(originals[1]),
            Object.keys(PlainInitializers),
            PlainInitializers.self === PlainInitializers,
          ],
        }));
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        usesPrivateNames: [true, 42, false, ["peek", "hasSecret", "self"], [], true],
        plainInitializers: [true, 42, [], ["self"], true],
      });
      expect(exitCode).toBe(0);
    });

    test("class with private static members keeps name-based private access working", async () => {
      // Private statics are installed on the class as written, so in this case
      // the name keeps referring to that class (esbuild's behavior): pointing
      // it at the replacement would make `Foo.#instances` throw.
      const { stdout, stderr, exitCode } = await runDecorator(`
        ${wrap}
        function keep(cls, ctx) {}
        @wrap class Foo {
          static #instances = 0;
          static create() { Foo.#instances++; return new Foo(); }
          static get instances() { return Foo.#instances; }
        }
        @keep class Bar {
          static #count = 0;
          #id = ++Bar.#count;
          static made = Bar.#count;
          static make() { return new Bar(); }
          id() { return this.#id; }
        }
        // Any private static member (a method, or a decorated one) is enough to
        // keep the name on the class as written, so the static fields that name
        // reaches must stay there too.
        @wrap class Store {
          static instances = [];
          static #register(instance) { Store.instances.push(instance); }
          constructor() { Store.#register(this); }
        }
        @wrap class Keyed {
          static registry = [];
          @keep static #key = "k";
          lookup() { return Keyed.registry; }
        }
        const store = new Store();
        Foo.create();
        Foo.create();
        console.log(JSON.stringify([
          tag(Foo),
          Foo.instances,
          Bar.make().id(),
          Bar.make().id(),
          Bar.made,
          Store.instances.length === 1 && Store.instances[0] === store,
          Object.hasOwn(Store, "instances"),
          new Keyed().lookup(),
          Object.hasOwn(Keyed, "registry"),
        ]));
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(["wrapped", 2, 1, 2, 0, true, false, [], false]);
      expect(exitCode).toBe(0);
    });

    test("class expressions: static fields move unless the body uses the expression's own name", async () => {
      const { stdout, stderr, exitCode } = await runDecorator(`
        ${wrap}
        const receivers = [];
        const Anonymous = @wrap class {
          static viaThis = (receivers.push(this), 1);
          static plain;
        };
        const Registry = @wrap class Inner {
          static entries = [];
          static add(entry) { Inner.entries.push(entry); return Inner.entries.length; }
        };
        console.log(JSON.stringify([
          tag(Anonymous),
          receivers[0] === Anonymous,
          Object.keys(Anonymous),
          tag(Registry),
          Registry.add("a"),
          Object.keys(Registry),
          Registry.entries,
        ]));
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        "wrapped",
        true,
        ["tag", "viaThis", "plain"],
        "wrapped",
        1,
        // Inner's body means the class as written, so entries stays there and is inherited.
        ["tag"],
        ["a"],
      ]);
      expect(exitCode).toBe(0);
    });

    test("exported and default-exported classes", async () => {
      using dir = tempDir("es-dec-replacement-exports", {
        "wrap.js": `
          export function wrap(cls, ctx) {
            return class Wrapped extends cls {};
          }
          export const marker = Symbol("marker");
        `,
        "named.js": `
          import { wrap, marker } from "./wrap.js";
          @wrap export class Named {
            static create() { return new Named(); }
            static self = Named;
            static fromImport = [marker];
          }
        `,
        "default.js": `
          import { wrap } from "./wrap.js";
          @wrap export default class Default {
            static create() { return new Default(); }
            static self = Default;
          }
        `,
        "entry.js": `
          import { Named } from "./named.js";
          import Default from "./default.js";
          console.log(JSON.stringify([
            Named.create() instanceof Named,
            Named.self === Named,
            Default.create() instanceof Default,
            Default.self === Default,
          ]));
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
      expect(JSON.parse(stdout)).toEqual([true, true, true, true]);
      expect(exitCode).toBe(0);
    });

    test("Bun.build keeps the bindings of same-named classes from different files apart", async () => {
      using dir = tempDir("es-dec-replacement-bundle", {
        "wrap.js": `
          export const wrap = label => (cls, ctx) => class Wrapped extends cls { static label = label; };
        `,
        "a.js": `
          import { wrap } from "./wrap.js";
          @wrap("a") export class Service {
            static create() { return new Service(); }
          }
        `,
        "b.js": `
          import { wrap } from "./wrap.js";
          @wrap("b") export class Service {
            static create() { return new Service(); }
          }
        `,
        "entry.js": `
          import { Service as A } from "./a.js";
          import { Service as B } from "./b.js";
          console.log(JSON.stringify([A.create().constructor.label, B.create().constructor.label]));
        `,
        "build.js": `
          for (const minify of [false, true]) {
            const result = await Bun.build({
              entrypoints: ["./entry.js"],
              outdir: "./out-" + minify,
              target: "bun",
              minify,
            });
            if (!result.success) throw new AggregateError(result.logs, "build failed");
            await import(result.outputs[0].path);
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
      expect(stdout).toBe('["a","b"]\n["a","b"]\n');
      expect(exitCode).toBe(0);
    });

    test("a class that never names itself gets no extra binding", () => {
      const transpiler = new Bun.Transpiler({ loader: "js", target: "bun" });
      const output = transpiler.transformSync(`
        @dec class Foo {
          static create() { return new this(); }
          method() {}
        }
      `);
      expect(output).toContain("__decorateElement");
      expect(output).not.toContain("_Foo");
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
