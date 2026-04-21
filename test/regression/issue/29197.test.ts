// https://github.com/oven-sh/bun/issues/29197 (and #27335)

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function runTS(
  source: string,
  extraCompilerOptions: Record<string, unknown> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  using dir = tempDir("bun-issue-29197", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        target: "es2022",
        ...extraCompilerOptions,
      },
    }),
    "index.ts": source,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  // Drain stderr concurrently — debug/ASAN builds can backpressure the
  // child on an unread pipe.
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("accessor field with a legacy decorator parses and runs", async () => {
  const { stdout, exitCode } = await runTS(`
    function example(target: any, key: any, desc: any): void {
      console.log("dec:" + key + ":" + typeof desc?.get + ":" + typeof desc?.set);
    }
    class Foo {
      @example accessor x = "value";
    }
    const f = new Foo();
    console.log("get:" + f.x);
    f.x = "other";
    console.log("set:" + f.x);
  `);

  expect(stdout).toBe("dec:x:function:function\nget:value\nset:other\n");
  expect(exitCode).toBe(0);
});

test.concurrent("undecorated accessor field parses and runs under experimentalDecorators", async () => {
  const { stdout, exitCode } = await runTS(`
    class Foo {
      accessor x = "value";
      accessor y: number = 42;
    }
    const f = new Foo();
    console.log(f.x, f.y);
    f.x = "other";
    f.y = 100;
    console.log(f.x, f.y);
  `);

  expect(stdout).toBe("value 42\nother 100\n");
  expect(exitCode).toBe(0);
});

test.concurrent("static accessor field parses and runs under experimentalDecorators", async () => {
  const { stdout, exitCode } = await runTS(`
    class Counter {
      static accessor count = 0;
    }
    console.log(Counter.count);
    Counter.count++;
    Counter.count++;
    console.log(Counter.count);
  `);

  expect(stdout).toBe("0\n2\n");
  expect(exitCode).toBe(0);
});

test.concurrent("static accessor field is accessible through a subclass", async () => {
  // A naive rewrite would emit `return this.#storage` for the synthesized
  // static getter/setter, which triggers JavaScript's private-field brand
  // check and throws TypeError when the receiver is a subclass. We must
  // dereference through the declaring class (`Counter.#storage`) instead.
  const { stdout, exitCode } = await runTS(`
    class Counter {
      static accessor count = 10;
    }
    class Sub extends Counter {}
    console.log(Sub.count);
    Sub.count = 99;
    console.log(Counter.count, Sub.count);
  `);

  expect(stdout).toBe("10\n99 99\n");
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/27335
test.concurrent("TypeScript accessibility modifier before accessor works", async () => {
  const { stdout, exitCode } = await runTS(`
    class Person {
      public accessor name: string = "John";
      protected accessor age: number = 30;
    }
    const p = new Person();
    console.log(p.name, (p as any).age);
    p.name = "Jane";
    (p as any).age = 31;
    console.log(p.name, (p as any).age);
  `);

  expect(stdout).toBe("John 30\nJane 31\n");
  expect(exitCode).toBe(0);
});

test.concurrent("accessor field in a class expression works under experimentalDecorators", async () => {
  const { stdout, exitCode } = await runTS(`
    const Foo = class {
      accessor x = 1;
    };
    const f = new Foo();
    console.log(f.x);
    f.x = 2;
    console.log(f.x);
  `);

  expect(stdout).toBe("1\n2\n");
  expect(exitCode).toBe(0);
});

test.concurrent("legacy decorator on accessor receives an accessor-style descriptor", async () => {
  // TypeScript's `__decorate` invokes property decorators with the
  // descriptor fetched via `Object.getOwnPropertyDescriptor`, so a decorator
  // applied to an `accessor` field sees `get`/`set` — not a data descriptor.
  const { stdout, exitCode } = await runTS(`
    function logDescriptor(target: any, key: any, descriptor: any) {
      const hasGet = typeof descriptor.get === "function";
      const hasSet = typeof descriptor.set === "function";
      const hasValue = "value" in descriptor;
      console.log(key, "get:" + hasGet, "set:" + hasSet, "value:" + hasValue);
    }
    class C {
      @logDescriptor accessor a = 1;
      @logDescriptor accessor b = "two";
    }
    new C();
  `);

  expect(stdout).toBe("a get:true set:true value:false\nb get:true set:true value:false\n");
  expect(exitCode).toBe(0);
});

test.concurrent("accessor field initializer can reference outer scope", async () => {
  const { stdout, exitCode } = await runTS(`
    const base = 10;
    class Box {
      accessor value = base + 5;
    }
    console.log(new Box().value);
  `);

  expect(stdout).toBe("15\n");
  expect(exitCode).toBe(0);
});

test.concurrent("accessor field with a non-identifier string key", async () => {
  // `"foo-bar"` is a valid class element name but NOT a valid private
  // identifier, so the helper must fall back to the counter-based
  // `#_accessor_storage_N` naming rather than emit `#foo-bar_accessor_storage`.
  const { stdout, exitCode } = await runTS(`
    class Weird {
      accessor "foo-bar" = 1;
      accessor "1" = 2;
    }
    const w: any = new Weird();
    console.log(w["foo-bar"], w["1"]);
    w["foo-bar"] = 10;
    w["1"] = 20;
    console.log(w["foo-bar"], w["1"]);
  `);

  expect(stdout).toBe("1 2\n10 20\n");
  expect(exitCode).toBe(0);
});

test.concurrent("accessor field with a computed key evaluates the key exactly once", async () => {
  // The rewrite expands one `accessor [expr]` into a field plus a getter and
  // a setter. Without hoisting, `expr` would run three times (or at least
  // twice for the get/set pair). This test asserts it runs exactly once.
  const { stdout, exitCode } = await runTS(`
    let calls = 0;
    const k = () => {
      calls++;
      return "dynamic";
    };
    class C {
      accessor [k()] = 42;
    }
    const c: any = new C();
    console.log("calls=" + calls, "value=" + c.dynamic);
    c.dynamic = 99;
    console.log("calls=" + calls, "value=" + c.dynamic);
  `);

  expect(stdout).toBe("calls=1 value=42\ncalls=1 value=99\n");
  expect(exitCode).toBe(0);
});

test.concurrent("synthesized backing storage does not collide with user private field", async () => {
  // A hostile class can declare `#_accessor_storage_0` itself — the
  // synthesized backing-field name must skip past any user-declared
  // collision rather than silently emit two members with the same
  // private identifier.
  const { stdout, exitCode } = await runTS(`
    class Foo {
      #_accessor_storage_0 = 999;
      accessor x = 1;
      accessor y = 2;
      getUserField() { return this.#_accessor_storage_0; }
    }
    const f = new Foo();
    console.log(f.x, f.y, f.getUserField());
    f.x = 10;
    f.y = 20;
    console.log(f.x, f.y, f.getUserField());
  `);

  expect(stdout).toBe("1 2 999\n10 20 999\n");
  expect(exitCode).toBe(0);
});

test.concurrent("computed-key temp does not clobber user variable of the same name", async () => {
  // The temp variable we hoist for computed-key evaluation uses a
  // `__bun_accessor_key_N$` name. If the user happens to bind that name
  // at module scope, we must pick a different N rather than emit a
  // duplicate `var` declaration.
  const { stdout, exitCode } = await runTS(`
    var __bun_accessor_key_0$ = "user-value";
    let keyCalls = 0;
    const key = () => { keyCalls++; return "k"; };
    class Foo {
      accessor [key()] = 1;
    }
    const f: any = new Foo();
    console.log("user:" + __bun_accessor_key_0$);
    console.log("f.k=" + f.k, "calls=" + keyCalls);
    f.k = 42;
    console.log("f.k=" + f.k, "calls=" + keyCalls);
    console.log("user-after:" + __bun_accessor_key_0$);
  `);

  expect(stdout).toBe("user:user-value\nf.k=1 calls=1\nf.k=42 calls=1\nuser-after:user-value\n");
  expect(exitCode).toBe(0);
});

test.concurrent("decorated computed-key accessor evaluates the key expression exactly once", async () => {
  // When a computed accessor has a legacy decorator, the rewrite emits
  // `get [(_tmp = expr())]() { ... }` for single-eval semantics, but the
  // decorator descriptor key passed to `__legacyDecorateClassTS(...)` must
  // be just `_tmp` — otherwise `__legacyDecorateClassTS` would re-run the
  // user expression when looking up the property descriptor.
  const { stdout, exitCode } = await runTS(`
    let calls = 0;
    const k = () => { calls++; return "dynamic"; };
    function dec(target: any, key: any, desc: any) {
      console.log("dec:" + key + ":has-desc:" + (desc != null));
    }
    class Foo {
      @dec accessor [k()] = 42;
    }
    const f: any = new Foo();
    console.log("calls=" + calls);
    console.log("val=" + f.dynamic);
  `);

  expect(stdout).toBe("dec:dynamic:has-desc:true\ncalls=1\nval=42\n");
  expect(exitCode).toBe(0);
});

test.concurrent("decorator metadata: accessor field records its declared type", () => {
  // Under `experimentalDecorators: true` + `emitDecoratorMetadata: true`,
  // a decorated typed accessor must still get `design:type` pointing to the
  // user's declared type — not `Object` (which is what happens if the
  // synthesized getter's `return_ts_metadata` is left defaulted).
  //
  // We check the emitted JavaScript directly rather than spawning a
  // subprocess with reflect-metadata, because the bug is in what Bun emits
  // and reflect-metadata is not normally installed in a tempDir.
  const transpiler = new Bun.Transpiler({
    loader: "ts",
    target: "bun",
    tsconfig: JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        target: "es2022",
      },
    }),
  });

  const out = transpiler.transformSync(`
    function collect(_t: any, _k: any) {}
    class Foo {
      @collect accessor str: string = "s";
      @collect accessor num: number = 1;
      @collect accessor bool: boolean = true;
    }
  `);

  // Each decorated accessor should emit a `design:type` metadata entry
  // pointing at the *declared type*, not `Object`. Bun's current legacy
  // metadata emission uses `__legacyMetadataTS("design:type", String)`
  // (or Number / Boolean) for these cases.
  expect(out).toContain('"design:type", String');
  expect(out).toContain('"design:type", Number');
  expect(out).toContain('"design:type", Boolean');
  // Sanity check: the accessor must have been lowered to a backing private
  // field, not left as the raw `accessor` keyword (JSC doesn't parse it).
  expect(out).toContain("_accessor_storage");
  expect(out).not.toMatch(/\baccessor\s+str\b/);
});

test.concurrent("sibling classes with computed accessor keys use distinct temp vars", async () => {
  // Two classes at the same hoisting scope each need a computed-key temp.
  // The counter must not reset to 0 between classes — otherwise both
  // classes would produce `var __bun_accessor_key_0$;` and the second
  // class would clobber the first.
  const { stdout, exitCode } = await runTS(`
    let calls = 0;
    const k = () => { calls++; return "k" + calls; };
    class A { accessor [k()] = 1; }
    class B { accessor [k()] = 2; }
    const a: any = new A();
    const b: any = new B();
    console.log(a.k1, b.k2, "calls=" + calls);
  `);

  expect(stdout).toBe("1 2 calls=2\n");
  expect(exitCode).toBe(0);
});

test.concurrent("decorator on a private accessor field is rejected like TypeScript", async () => {
  // TypeScript emits `TS1206: Decorators are not valid here` for
  // `@dec accessor #x` under `experimentalDecorators`. Bun's parser
  // rejects it at the private-identifier property branch too (the
  // legacy-decorator model doesn't support decorating private class
  // members directly). This test locks in the rejection so a future
  // relaxation doesn't accidentally land a half-implemented lowering.
  const { stdout, stderr, exitCode } = await runTS(`
    function dec(target: any, key: any, desc: any) {}
    class Foo {
      @dec accessor #x = 5;
    }
    new Foo();
  `);

  expect(stdout).toBe("");
  expect(stderr).toContain("#x");
  expect(exitCode).not.toBe(0);
});

test.concurrent("decorated accessor in a class expression is rejected with a clear error", async () => {
  // Legacy decorators on any class-expression member are a pre-existing
  // Bun gap. Until that gap is closed, refuse to silently drop a decorator
  // on an auto-accessor inside a class expression — users need explicit
  // feedback, not code that silently ignores their decorator.
  const { stdout, stderr, exitCode } = await runTS(`
    function dec(_t: any, _k: any, _d: any) {}
    const C = class {
      @dec accessor x = 1;
    };
    new C();
  `);

  expect(stdout).toBe("");
  expect(stderr).toContain("class expression");
  expect(exitCode).not.toBe(0);
});

test.concurrent("anonymous `export default class` with an accessor does not panic (#29197)", async () => {
  // Regression: `export default class { static accessor x = 1 }` used
  // to trip a null-ref panic in `lowerStandardDecoratorsStmt` because
  // `class.class_name` was only injected from `default_name` when the
  // class had decorators. Auto-accessors go through the same lowering,
  // so the name injection now also runs when any property is an
  // `auto_accessor`.
  using dir = tempDir("bun-issue-29197-default-export", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: false,
        target: "es2022",
      },
    }),
    "base.ts": "export default class { static accessor x = 1; }\n",
    "main.ts":
      "import Base from './base';\n" +
      "console.log('x=', Base.x);\n" +
      "Base.x = 42;\n" +
      "console.log('x=', Base.x);\n",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("panic");
  expect(stdout).toBe("x= 1\nx= 42\n");
  expect(exitCode).toBe(0);
});
