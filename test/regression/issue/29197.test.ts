// https://github.com/oven-sh/bun/issues/29197 (and #27335)
//
// The `accessor` keyword (TC39 auto-accessors / TS 4.9+) was rejected as a
// syntax error when a project's tsconfig.json had `experimentalDecorators: true`.
// The keyword should be accepted under either decorator mode. JSC doesn't
// parse `accessor` natively, so any class with auto-accessors is routed
// through the standard-decorator lowering (WeakMap + getter/setter)
// regardless of mode. Mixing `accessor` with legacy TS decorators errors
// clearly instead of silently rerouting decorators through the standard
// runtime.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function runBun(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
}

test.concurrent("accessor with various modifiers under experimentalDecorators: true", async () => {
  using dir = tempDir("issue-29197-modifiers", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { experimentalDecorators: true },
    }),
    "main.ts": `class Foo {
  accessor a = 1;
  public accessor b = 2;
  private accessor c = 3;
  protected accessor d = 4;
  static accessor e = 5;
  readonly accessor f = 6;
  getC() { return this.c; }
  getD() { return this.d; }
}
const f = new Foo();
console.log(f.a, f.b, f.getC(), f.getD(), Foo.e, f.f);
`,
  });

  const [stdout, , exitCode] = await runBun(String(dir), "main.ts");
  expect(stdout).toBe("1 2 3 4 5 6\n");
  expect(exitCode).toBe(0);
});

test.concurrent("accessor without tsconfig (TS file, no decorator flags)", async () => {
  using dir = tempDir("issue-29197-plain", {
    "main.ts": `class Foo {
  accessor x: number = 42;
}
console.log(new Foo().x);
`,
  });

  const [stdout, , exitCode] = await runBun(String(dir), "main.ts");
  expect(stdout).toBe("42\n");
  expect(exitCode).toBe(0);
});

test.concurrent("accessor still works under standard decorators mode", async () => {
  using dir = tempDir("issue-29197-std", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { experimentalDecorators: false },
    }),
    "main.ts": `function dec(value: any, context: any) {
  console.log("dec", context.name, context.kind);
}
class Foo {
  @dec accessor x: number = 7;
}
console.log(new Foo().x);
`,
  });

  const [stdout, , exitCode] = await runBun(String(dir), "main.ts");
  expect(stdout).toBe("dec x accessor\n7\n");
  expect(exitCode).toBe(0);
});

test.concurrent(
  "mixing accessor with experimentalDecorators legacy @dec is a clear error, not silent wrong semantics",
  async () => {
    using dir = tempDir("issue-29197-mixed", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { experimentalDecorators: true },
      }),
      "main.ts": `function legacyDec(target: any, key: string) {}

class Foo {
  @legacyDec
  doThing() {}

  accessor x: number = 0;
}
`,
    });

    const [, stderr, exitCode] = await runBun(String(dir), "main.ts");
    expect(stderr).toContain("Cannot mix the `accessor` keyword with `experimentalDecorators: true`");
    expect(exitCode).not.toBe(0);
  },
);

test.concurrent("static accessor field: direct access works; subclass access throws (TC39 spec)", async () => {
  // The standard-decorator lowering stores static accessor state in a
  // WeakMap keyed on the declaring class. `Counter.count` round-trips; a
  // subclass access (`Sub.count`) invokes the inherited getter with
  // `this === Sub`, which is not in the WeakMap — matches TC39's static
  // private-field brand-check semantics (TypeError at the key lookup).
  using dir = tempDir("issue-29197-subclass", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { experimentalDecorators: false },
    }),
    "main.ts": `class Counter { static accessor count = 10; }
class Sub extends Counter {}
console.log(Counter.count);
Counter.count = 99;
console.log(Counter.count);
try {
  console.log("Sub.count=", Sub.count);
} catch (e) {
  console.log("Sub caught:", (e as any).name);
}
`,
  });

  const [stdout, , exitCode] = await runBun(String(dir), "main.ts");
  expect(stdout).toBe("10\n99\nSub caught: TypeError\n");
  expect(exitCode).toBe(0);
});

test.concurrent("accessor field in a class expression", async () => {
  using dir = tempDir("issue-29197-expr", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { experimentalDecorators: false },
    }),
    "main.ts": `const Foo = class { accessor x = 1; };
const f = new Foo();
console.log(f.x);
f.x = 2;
console.log(f.x);
`,
  });

  const [stdout, , exitCode] = await runBun(String(dir), "main.ts");
  expect(stdout).toBe("1\n2\n");
  expect(exitCode).toBe(0);
});

test.concurrent(
  "newline between `accessor` and the name triggers ASI (two fields, not one auto-accessor)",
  async () => {
    // TC39 grammar: `accessor [no LineTerminator here] ClassElementName`.
    // With a newline, `accessor` must be parsed as a plain field name
    // terminated by ASI, and the following `y = 1` becomes a second
    // data field — NOT a single auto-accessor `y`. Matches tsc/esbuild.
    using dir = tempDir("issue-29197-asi", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { experimentalDecorators: true },
      }),
      "main.ts": `class C {
  accessor
  y = 1
}
const c = new C() as any;
console.log("keys:", Object.getOwnPropertyNames(c).sort().join(","));
console.log("accessor:", c.accessor);
console.log("y:", c.y);
`,
    });

    const [stdout, , exitCode] = await runBun(String(dir), "main.ts");
    expect(stdout).toBe("keys: accessor,y\naccessor: undefined\ny: 1\n");
    expect(exitCode).toBe(0);
  },
);

test.concurrent(
  "`static accessor` with a side-effecting initializer is not hoisted past preceding statements",
  async () => {
    // Non-bundle tree-shaking calls `G::Class::can_be_moved()` on the
    // pre-visit AST. `can_be_moved` used to only inspect `.Normal` static
    // initializers, so a class with `static accessor x = sideEffect()` was
    // (incorrectly) treated as movable and hoisted ahead of preceding
    // statements, inverting evaluation order.
    using dir = tempDir("issue-29197-hoist", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { experimentalDecorators: false },
      }),
      "main.ts":
        'console.log("first");\n' +
        "export class Foo {\n" +
        '  static accessor x = (console.log("second"), 42);\n' +
        "}\n" +
        'console.log("third");\n',
    });

    const [stdout, stderr, exitCode] = await runBun(String(dir), "main.ts");
    expect(stderr).not.toContain("panic");
    expect(stdout).toBe("first\nsecond\nthird\n");
    expect(exitCode).toBe(0);
  },
);

test.concurrent("anonymous `export default class` with a static accessor does not panic", async () => {
  // Regression: `export default class { static accessor x = 1 }` used
  // to trip a null-ref panic in `lower_standard_decorators_stmt` because
  // `class.class_name` was only injected from `default_name` when the
  // class had decorators. Auto-accessors go through the same lowering,
  // so the name injection now also runs when any property is an
  // `AutoAccessor`.
  using dir = tempDir("issue-29197-default-export", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { experimentalDecorators: false },
    }),
    "base.ts": "export default class { static accessor x = 1; }\n",
    "main.ts":
      "import Base from './base';\n" +
      "console.log('x=', Base.x);\n" +
      "Base.x = 42;\n" +
      "console.log('x=', Base.x);\n",
  });

  const [stdout, stderr, exitCode] = await runBun(String(dir), "main.ts");
  expect(stderr).not.toContain("panic");
  expect(stdout).toBe("x= 1\nx= 42\n");
  expect(exitCode).toBe(0);
});
