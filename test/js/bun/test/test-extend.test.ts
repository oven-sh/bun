// test.extend() fixtures: https://github.com/oven-sh/bun/issues/8257
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("test.extend", () => {
  // ── happy paths run inline in this file through the real runner ──────────

  const withValues = test.extend<{ port: number; names: string[] }>({
    port: 3000,
    names: ["alice", "bob"],
  });

  withValues("provides plain value fixtures", ({ port, names }) => {
    expect(port).toBe(3000);
    expect(names).toEqual(["alice", "bob"]);
  });

  // setup/teardown ordering across dependent fixtures
  const order: string[] = [];
  const withDeps = test.extend<{ base: string; derived: string }>({
    base: async ({}, use) => {
      order.push("setup base");
      await use("base-value");
      order.push("teardown base");
    },
    derived: async ({ base }, use) => {
      order.push("setup derived");
      await use(`derived-of-${base}`);
      order.push("teardown derived");
    },
  });

  withDeps("initializes dependencies before dependents", ({ derived, base }) => {
    expect(base).toBe("base-value");
    expect(derived).toBe("derived-of-base-value");
    expect(order).toEqual(["setup base", "setup derived"]);
    order.push("test body");
  });

  test("teardown ran in reverse setup order after the previous test", () => {
    expect(order).toEqual(["setup base", "setup derived", "test body", "teardown derived", "teardown base"]);
  });

  // laziness
  const initialized: string[] = [];
  const lazy = test.extend<{ used: number; unused: number; auto: number }>({
    used: async ({}, use) => {
      initialized.push("used");
      await use(1);
    },
    unused: async ({}, use) => {
      initialized.push("unused");
      await use(2);
    },
    auto: [
      async ({}, use) => {
        initialized.push("auto");
        await use(3);
      },
      { auto: true },
    ],
  });

  lazy("only sets up destructured and auto fixtures", ({ used }) => {
    expect(used).toBe(1);
    expect(initialized).toEqual(["used", "auto"]);
  });

  // chaining + overriding
  const baseTest = test.extend<{ a: number; b: number }>({ a: 1, b: 2 });
  const chained = baseTest.extend<{ b: number; c: number }>({ b: 20, c: 3 });

  baseTest("base fixtures are unchanged by later extends", ({ a, b }) => {
    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  chained("chained extend merges and overrides fixtures", ({ a, b, c }) => {
    expect(a).toBe(1);
    expect(b).toBe(20);
    expect(c).toBe(3);
  });

  // fixture functions can depend on overridden fixtures
  const overridden = test
    .extend<{ value: number; doubled: number }>({
      value: 1,
      doubled: async ({ value }, use) => {
        await use(value * 2);
      },
    })
    .extend<{ value: number }>({ value: 21 });

  overridden("dependencies resolve against the overriding fixture", ({ doubled }) => {
    expect(doubled).toBe(42);
  });

  // diamond dependencies: d -> (b, c) -> a. The shared dependency is set up
  // exactly once and torn down exactly once, in reverse setup order.
  const diamondOrder: string[] = [];
  const diamond = test.extend<{ a: number; b: number; c: number; d: number }>({
    a: async ({}, use) => {
      diamondOrder.push("+a");
      await use(1);
      diamondOrder.push("-a");
    },
    b: async ({ a }, use) => {
      diamondOrder.push("+b");
      await use(a + 1);
      diamondOrder.push("-b");
    },
    c: async ({ a }, use) => {
      diamondOrder.push("+c");
      await use(a + 2);
      diamondOrder.push("-c");
    },
    d: async ({ b, c }, use) => {
      diamondOrder.push("+d");
      await use(b + c);
      diamondOrder.push("-d");
    },
  });

  diamond("diamond dependencies set up the shared fixture once", ({ d }) => {
    expect(d).toBe(5); // b = 2, c = 3
    expect(diamondOrder).toEqual(["+a", "+b", "+c", "+d"]);
  });

  test("diamond teardown ran once per fixture, in reverse order", () => {
    expect(diamondOrder).toEqual(["+a", "+b", "+c", "+d", "-d", "-c", "-b", "-a"]);
  });

  // fixture functions may return the value instead of calling use(); a
  // disposable return value (Symbol.asyncDispose / Symbol.dispose) is disposed
  // after the test as the fixture's teardown
  const disposeLog: string[] = [];
  const returned = test.extend<{
    res: { tag: string; [Symbol.asyncDispose](): Promise<void>; [Symbol.dispose](): void };
    syncRes: { [Symbol.dispose](): void };
    plain: number;
    nothing: null;
  }>({
    res: () => ({
      tag: "res",
      async [Symbol.asyncDispose]() {
        disposeLog.push("asyncDispose res");
      },
      [Symbol.dispose]() {
        disposeLog.push("dispose res");
      },
    }),
    syncRes: async () => ({
      [Symbol.dispose]() {
        disposeLog.push("dispose syncRes");
      },
    }),
    plain: ({ res }) => (disposeLog.push("create plain"), res.tag.length),
    nothing: () => null,
  });

  returned("return-style fixtures provide the returned value", ({ res, syncRes, plain, nothing }) => {
    expect(res.tag).toBe("res");
    expect(typeof syncRes[Symbol.dispose]).toBe("function");
    expect(plain).toBe(3);
    expect(nothing).toBeNull();
    expect(disposeLog).toEqual(["create plain"]);
  });

  test("returned disposables were disposed in reverse order, preferring asyncDispose", () => {
    // `plain` has no teardown; `syncRes` only has Symbol.dispose; `res` has
    // both and asyncDispose wins. Setup order was res, syncRes, plain.
    expect(disposeLog).toEqual(["create plain", "dispose syncRes", "asyncDispose res"]);
  });

  // `await using` inside a use()-style fixture disposes when the fixture
  // function resumes after the test
  const usingLog: string[] = [];
  const usingFixture = test.extend<{ conn: { name: string } }>({
    conn: async ({}, use) => {
      await using guard = {
        async [Symbol.asyncDispose]() {
          usingLog.push("disposed");
        },
      };
      expect(guard).toBeDefined();
      await use({ name: "conn" });
      usingLog.push("after use");
    },
  });

  usingFixture("await using composes with use()-style fixtures", ({ conn }) => {
    expect(conn.name).toBe("conn");
    expect(usingLog).toEqual([]);
  });

  test("await using declarations in fixtures were disposed after the test", () => {
    expect(usingLog).toEqual(["after use", "disposed"]);
  });

  // a [value, options] tuple whose second element carries no fixture option keys
  // is a plain array fixture value, not a tuple
  const plainTuple = test.extend<{ pair: unknown }>({ pair: [1, { other: true }] as any });
  plainTuple("an array without fixture options is a plain value", ({ pair }) => {
    expect(pair).toEqual([1, { other: true }]);
  });

  // destructuring forms
  const forms = test.extend<{ "quoted-name": number; renamed: number; defaulted: number }>({
    "quoted-name": 7,
    renamed: 8,
    defaulted: 9,
  });

  forms(
    "supports quoted keys, renames and defaults in the pattern",
    ({ "quoted-name": q, renamed: r, defaulted = 0 }) => {
      expect(q).toBe(7);
      expect(r).toBe(8);
      expect(defaulted).toBe(9);
    },
  );

  // modifiers are preserved on extended test functions
  const modTest = test.extend<{ n: number }>({ n: 5 });
  modTest.skip("skip on an extended test is still skip", () => {
    throw new Error("should not run");
  });
  modTest.todo("todo on an extended test is still todo");
  modTest.skipIf(true)("skipIf(true) on an extended test skips", () => {
    throw new Error("should not run");
  });
  modTest.if(true)("if(true) on an extended test runs with fixtures", ({ n }) => {
    expect(n).toBe(5);
  });

  // .each combined with fixtures: case args come first, context last
  modTest.each([
    [1, 2],
    [3, 4],
  ])("each %d %d passes case args before the context", (x, y, { n }) => {
    expect(typeof x).toBe("number");
    expect(typeof y).toBe("number");
    expect(n).toBe(5);
  });

  // async value through use()
  const asyncFixture = test.extend<{ later: string }>({
    later: async ({}, use) => {
      const value = await Promise.resolve("resolved");
      await use(value);
    },
  });

  asyncFixture("awaits asynchronous fixture setup", ({ later }) => {
    expect(later).toBe("resolved");
  });

  // concurrent tests each get their own context. A shared barrier guarantees
  // all three test bodies overlap before any of them re-checks its context.
  const concurrent = test.extend<{ bag: { id?: number } }>({
    bag: async ({}, use) => {
      await use({});
    },
  });

  let startedCount = 0;
  const allStarted = Promise.withResolvers<void>();
  concurrent.concurrent.each([[1], [2], [3]])("concurrent test %d has an isolated context", async (id, { bag }) => {
    expect(bag.id).toBeUndefined();
    bag.id = id;
    if (++startedCount === 3) allStarted.resolve();
    await allStarted.promise;
    expect(bag.id).toBe(id);
  });

  // validation errors thrown at .extend() call time
  test("extend() rejects non-object arguments", () => {
    expect(() => (test as any).extend()).toThrow("test.extend() expects an object");
    expect(() => (test as any).extend(null)).toThrow("test.extend() expects an object");
    expect(() => (test as any).extend([1, 2])).toThrow("test.extend() expects an object");
    expect(() => (test as any).extend("nope")).toThrow("test.extend() expects an object");
  });

  test("extend() rejects unsupported fixture options", () => {
    expect(() => (test as any).extend({ db: [1, { scope: "worker" }] })).toThrow('scope "worker" is not supported');
    expect(() => (test as any).extend({ db: [1, { injected: true }] })).toThrow('"injected" option is not supported');
  });

  test("extend() is not available on describe", () => {
    expect(() => (describe as any).extend({})).toThrow("Cannot call .extend() on describe");
  });
});

// ── failure modes run in a child process so they don't fail this file ──────

async function runFixtureFile(contents: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  using dir = tempDir("test-extend", { "fixture.test.ts": contents });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "fixture.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("test.extend failure modes", () => {
  test("fixture setup error fails the test and tears down earlier fixtures", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test, expect } from "bun:test";
      const t = test.extend<{ ok: string; bad: string }>({
        ok: async ({}, use) => {
          console.error("setup ok");
          await use("ok");
          console.error("teardown ok");
        },
        bad: async ({ ok }, use) => {
          throw new Error("setup exploded");
        },
      });
      t("uses bad fixture", ({ bad }) => {});
      t("later test still runs", ({ ok }) => {
        expect(ok).toBe("ok");
      });
    `);
    expect(stderr).toContain("setup exploded");
    // the already-initialized fixture was torn down even though setup failed
    expect(stderr).toContain("teardown ok");
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("fixture teardown error fails the test", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test } from "bun:test";
      const t = test.extend<{ leaky: number }>({
        leaky: async ({}, use) => {
          await use(1);
          throw new Error("teardown exploded");
        },
      });
      t("body passes but teardown fails", ({ leaky }) => {});
    `);
    expect(stderr).toContain("teardown exploded");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("test body error takes precedence and teardown still runs", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test } from "bun:test";
      const t = test.extend<{ res: number }>({
        res: async ({}, use) => {
          await use(1);
          console.error("teardown ran");
        },
      });
      t("fails", ({ res }) => {
        throw new Error("body exploded");
      });
    `);
    expect(stderr).toContain("body exploded");
    expect(stderr).toContain("teardown ran");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("a fixture that neither calls use() nor returns a value fails the test", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test } from "bun:test";
      const t = test.extend<{ nope: number }>({
        nope: async ({}, use) => {},
      });
      t("uses nope", ({ nope }) => {});
    `);
    expect(stderr).toContain('Fixture "nope" completed without calling use() or returning a value');
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("calling use() twice fails the test instead of deadlocking", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test } from "bun:test";
      const t = test.extend<{ x: number }>({
        x: async ({}, use) => {
          await use(1);
          await use(2);
        },
      });
      t("double use", ({ x }) => {});
    `);
    expect(stderr).toContain('Fixture "x" called use() more than once');
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("a throwing Symbol.asyncDispose on a returned fixture value fails the test", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test } from "bun:test";
      const t = test.extend<{ bad: object }>({
        bad: () => ({
          async [Symbol.asyncDispose]() {
            throw new Error("dispose exploded");
          },
        }),
      });
      t("uses bad", ({ bad }) => {});
    `);
    expect(stderr).toContain("dispose exploded");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("circular fixture dependencies fail the test", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test } from "bun:test";
      const t = test.extend<{ a: number; b: number }>({
        a: async ({ b }, use) => {
          await use(1);
        },
        b: async ({ a }, use) => {
          await use(2);
        },
      });
      t("circular", ({ a }) => {});
    `);
    expect(stderr).toContain("Circular fixture dependency: a -> b -> a");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("a non-destructured context parameter with fixtures fails with a helpful error", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test } from "bun:test";
      const t = test.extend<{ db: number }>({ db: 1 });
      t("bad signature", (context) => {});
    `);
    expect(stderr).toContain("must use object destructuring");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("rest parameters in the destructuring pattern fail with a helpful error", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test } from "bun:test";
      const t = test.extend<{ db: number }>({ db: 1 });
      t("rest", ({ ...rest }) => {});
    `);
    expect(stderr).toContain("Rest parameters are not supported");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("fixtures are re-created for each retry", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test, expect } from "bun:test";
      let setups = 0;
      let attempts = 0;
      const t = test.extend<{ n: number }>({
        n: async ({}, use) => {
          setups++;
          await use(setups);
        },
      });
      t("retry gets a fresh fixture", ({ n }) => {
        attempts++;
        expect(n).toBe(attempts);
        if (attempts < 3) throw new Error("flaky");
      }, { retry: 5 });
    `);
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test("extended test callbacks never receive a done callback", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test, expect } from "bun:test";
      // a plain test with a parameter receives a done callback and would hang
      // until timeout if it is never called; an extended test's parameter is
      // the fixture context object instead.
      const t = test.extend({});
      t("context instead of done", (context) => {
        expect(typeof context).toBe("object");
      });
    `);
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test("beforeEach/afterEach hooks run around fixture setup and teardown", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test, beforeEach, afterEach } from "bun:test";
      beforeEach(() => console.error("hook: beforeEach"));
      afterEach(() => console.error("hook: afterEach"));
      const t = test.extend<{ f: number }>({
        f: async ({}, use) => {
          console.error("fixture: setup");
          await use(1);
          console.error("fixture: teardown");
        },
      });
      t("ordering", ({ f }) => {
        console.error("test body");
      });
    `);
    const lines = stderr
      .split(/\r?\n/)
      .filter(line => line.startsWith("hook:") || line.startsWith("fixture:") || line.startsWith("test body"));
    expect(lines).toEqual(["hook: beforeEach", "fixture: setup", "test body", "fixture: teardown", "hook: afterEach"]);
    expect(exitCode).toBe(0);
  });
});
