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

  // with no fixtures registered there is nothing to detect, so any parameter
  // shape works and receives the (empty) context
  const empty = test.extend({});
  empty("an empty fixture map still passes a context object", (...args) => {
    expect(args).toEqual([{}]);
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

  // fixture functions depend on the overriding definition of other fixtures
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

  // an override that destructures its own name builds on the definition it replaces
  const overrideOrder: string[] = [];
  const wrapped = test
    .extend<{ db: string[] }>({
      db: async ({}, use) => {
        overrideOrder.push("setup original");
        await use(["original"]);
        overrideOrder.push("teardown original");
      },
    })
    .extend<{ db: string[] }>({
      db: async ({ db }, use) => {
        overrideOrder.push("setup override");
        await use([...db, "override"]);
        overrideOrder.push("teardown override");
      },
    })
    .extend<{ db: string[] }>({
      db: async ({ db }, use) => {
        overrideOrder.push("setup second override");
        await use([...db, "second override"]);
        overrideOrder.push("teardown second override");
      },
    });

  wrapped("an override receives the value of the definition it replaces", ({ db }) => {
    expect(db).toEqual(["original", "override", "second override"]);
    expect(overrideOrder).toEqual(["setup original", "setup override", "setup second override"]);
  });

  test("override chains tear down innermost first", () => {
    expect(overrideOrder).toEqual([
      "setup original",
      "setup override",
      "setup second override",
      "teardown second override",
      "teardown override",
      "teardown original",
    ]);
  });

  const wrappedValue = test.extend<{ n: number }>({ n: 20 }).extend<{ n: number }>({
    n: async ({ n }, use) => {
      await use(n + 22);
    },
  });
  wrappedValue("an override can build on a plain value fixture", ({ n }) => {
    expect(n).toBe(42);
  });

  // an override inherits `auto` unless it specifies its own options
  const autoLog: string[] = [];
  const autoBase = test.extend<{ tracker: string }>({
    tracker: [
      async ({}, use) => {
        autoLog.push("base");
        await use("base");
      },
      { auto: true },
    ],
  });
  const autoInherited = autoBase.extend<{ tracker: string }>({
    tracker: async ({}, use) => {
      autoLog.push("inherited");
      await use("inherited");
    },
  });
  const autoDisabled = autoBase.extend<{ tracker: string }>({
    tracker: [
      async ({}, use) => {
        autoLog.push("disabled");
        await use("disabled");
      },
      { auto: false },
    ],
  });
  autoInherited("an override inherits auto from the definition it replaces", () => {
    expect(autoLog).toEqual(["inherited"]);
  });
  autoDisabled("an override with its own options replaces auto", () => {
    expect(autoLog).toEqual(["inherited"]);
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

  // `await using` inside a fixture disposes when the fixture function resumes
  // after the test
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

  usingFixture("await using inside a fixture is still alive during the test", ({ conn }) => {
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

  // a test callback whose source is unavailable gets every fixture
  const unreadable: string[] = [];
  const unreadableTest = test.extend<{ a: number; b: number }>({
    a: async ({}, use) => {
      unreadable.push("a");
      await use(1);
    },
    b: async ({}, use) => {
      unreadable.push("b");
      await use(2);
    },
  });
  unreadableTest(
    "a bound test callback receives every fixture",
    function ({ a, b }: { a: number; b: number }) {
      expect([a, b]).toEqual([1, 2]);
      expect(unreadable).toEqual(["a", "b"]);
    }.bind(null),
  );

  // only the function's shape marks it unreadable, not the words "[native code]" appearing in its body
  const nativeText = test.extend<{ base: number; derived: string }>({
    base: 2,
    derived: async ({ base }, use) => {
      await use(`${base} [native code]`);
    },
  });
  nativeText("a fixture body may mention [native code]", ({ derived }) => {
    expect(derived).toBe("2 [native code]");
  });

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

  // .each combined with fixtures, in either order: case args come first, context last
  modTest.each([
    [1, 2],
    [3, 4],
  ])("extend().each() %d %d passes case args before the context", (x, y, { n }) => {
    expect(typeof x).toBe("number");
    expect(typeof y).toBe("number");
    expect(n).toBe(5);
  });

  const eachSeen: number[] = [];
  test.each([[10], [20]]).extend<{ n: number }>({ n: 5 })(
    "each().extend() %d passes case args before the context",
    (x, { n }) => {
      expect(n).toBe(5);
      eachSeen.push(x);
    },
  );

  test("each().extend() ran once per row", () => {
    expect(eachSeen).toEqual([10, 20]);
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

// ── lifecycle and failure modes run in a child process ──────────────────────

async function runFixtureFile(contents: string) {
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

/** The `error: ...` lines the runner printed, in order. */
function errorLines(stderr: string): string[] {
  return stderr.split(/\r?\n/).filter(line => line.startsWith("error: "));
}

/** The `event: ...` lines a fixture file logged, in order. */
function events(stderr: string): string[] {
  return stderr
    .split(/\r?\n/)
    .filter(line => line.startsWith("event:"))
    .map(line => line.slice("event:".length).trim());
}

describe.concurrent("test.extend lifecycle", () => {
  test("fixtures are set up after beforeEach and torn down after afterEach, before onTestFinished", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test, beforeEach, afterEach, onTestFinished } from "bun:test";
      beforeEach(() => console.error("event: beforeEach"));
      afterEach(() => console.error("event: afterEach"));
      const t = test.extend<{ f: number }>({
        f: async ({}, use) => {
          console.error("event: setup");
          await use(1);
          console.error("event: teardown");
        },
      });
      t("ordering", ({ f }) => {
        afterEach(() => console.error("event: afterEach registered inside the test"));
        onTestFinished(() => console.error("event: onTestFinished"));
        console.error("event: body");
      });
    `);
    expect(events(stderr)).toEqual([
      "beforeEach",
      "setup",
      "body",
      "afterEach registered inside the test",
      "afterEach",
      "teardown",
      "onTestFinished",
    ]);
    expect(exitCode).toBe(0);
  });

  test("fixtures registered inside an AsyncLocalStorage context see its store", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test, expect } from "bun:test";
      import { AsyncLocalStorage } from "node:async_hooks";
      const als = new AsyncLocalStorage<string>();
      const t = test.extend<{ f: string }>({
        f: async ({}, use) => {
          console.error("event: setup sees " + als.getStore());
          await use("f");
          console.error("event: teardown sees " + als.getStore());
        },
      });
      als.run("store", () => {
        t("plain", ({ f }) => {
          expect(f).toBe("f");
          console.error("event: body sees " + als.getStore());
        });
        t.each([1])("each %d", (n, { f }) => {
          expect(f).toBe("f");
          console.error("event: each " + n + " sees " + als.getStore());
        });
      });
    `);
    expect(events(stderr)).toEqual([
      "setup sees store",
      "body sees store",
      "teardown sees store",
      "setup sees store",
      "each 1 sees store",
      "teardown sees store",
    ]);
    expect(stderr).toContain("2 pass");
    expect(exitCode).toBe(0);
  });

  test("a test that times out is still torn down, after its afterEach hooks", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test, afterEach, expect } from "bun:test";
      afterEach(() => console.error("event: afterEach"));
      const t = test.extend<{ server: string }>({
        server: async ({}, use) => {
          console.error("event: setup");
          await use("listening");
          console.error("event: teardown");
        },
      });
      t("hangs", async ({ server }) => {
        console.error("event: body");
        await new Promise(() => {});
      }, { timeout: 50 });
      t("the next test gets a fresh fixture", ({ server }) => {
        expect(server).toBe("listening");
        console.error("event: next body");
      });
    `);
    expect(events(stderr)).toEqual([
      "setup",
      "body",
      "afterEach",
      "teardown",
      "setup",
      "next body",
      "afterEach",
      "teardown",
    ]);
    expect(stderr).toContain("timed out after 50ms");
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("a throwing afterEach hook does not skip fixture teardown", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test, afterEach } from "bun:test";
      afterEach(() => {
        throw new Error("afterEach exploded");
      });
      const t = test.extend<{ f: number }>({
        f: async ({}, use) => {
          await use(1);
          console.error("event: teardown");
        },
      });
      t("body passes", ({ f }) => {});
    `);
    expect(events(stderr)).toEqual(["teardown"]);
    expect(stderr).toContain("afterEach exploded");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("a failing beforeEach hook skips setup, and there is nothing to tear down", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test, beforeEach } from "bun:test";
      beforeEach(() => {
        throw new Error("beforeEach exploded");
      });
      const t = test.extend<{ f: number }>({
        f: async ({}, use) => {
          console.error("event: setup");
          await use(1);
          console.error("event: teardown");
        },
      });
      t("never runs", ({ f }) => {
        console.error("event: body");
      });
    `);
    expect(events(stderr)).toEqual([]);
    expect(stderr).toContain("beforeEach exploded");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("fixture setup error fails the test and tears down earlier fixtures", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test, expect } from "bun:test";
      const t = test.extend<{ ok: string; bad: string }>({
        ok: async ({}, use) => {
          console.error("event: setup ok");
          await use("ok");
          console.error("event: teardown ok");
        },
        bad: async ({ ok }, use) => {
          throw new Error("setup exploded");
        },
      });
      t("uses bad fixture", ({ bad }) => {
        console.error("event: body");
      });
      t("later test still runs", ({ ok }) => {
        expect(ok).toBe("ok");
      });
    `);
    expect(events(stderr)).toEqual(["setup ok", "teardown ok", "setup ok", "teardown ok"]);
    expect(stderr).toContain("setup exploded");
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("fixture teardown error fails a test whose body passed", async () => {
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
    expect(stderr).not.toContain("Unhandled error");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("body and teardown errors are all reported", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test } from "bun:test";
      const t = test.extend<{ first: number; second: number }>({
        first: async ({}, use) => {
          await use(1);
          console.error("event: teardown first");
          throw new Error("first teardown exploded");
        },
        second: async ({}, use) => {
          await use(2);
          console.error("event: teardown second");
          throw new Error("second teardown exploded");
        },
      });
      t("everything fails", ({ first, second }) => {
        throw new Error("body exploded");
      });
    `);
    expect(events(stderr)).toEqual(["teardown second", "teardown first"]);
    // the body error and each teardown error (unpacked from the AggregateError)
    // are reported exactly once, under the one failing test
    expect(errorLines(stderr)).toEqual([
      "error: body exploded",
      "error: second teardown exploded",
      "error: first teardown exploded",
    ]);
    expect(stderr).not.toContain("Unhandled error");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("a fixture that fails after use() is reported once, by the teardown", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test } from "bun:test";
      const t = test.extend<{ server: number }>({
        server: async ({}, use) => {
          await Promise.race([use(1), Promise.reject(new Error("server closed unexpectedly"))]);
        },
      });
      t("body runs to completion", async ({ server }) => {
        await Promise.resolve();
        console.error("event: body finished");
      });
      t("next test still runs", () => {
        console.error("event: next test");
      });
    `);
    expect(events(stderr)).toEqual(["body finished", "next test"]);
    expect(errorLines(stderr)).toEqual(["error: server closed unexpectedly"]);
    expect(stderr).not.toContain("Unhandled error");
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("a fixture that never calls use() fails the test", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test } from "bun:test";
      const t = test.extend<{ nope: number }>({
        nope: async ({}, use) => {},
      });
      t("uses nope", ({ nope }) => {});
    `);
    expect(stderr).toContain('Fixture "nope" completed without calling use()');
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

  test("a first definition that destructures its own name fails the test", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test } from "bun:test";
      const t = test.extend({
        db: async ({ db }, use) => {
          await use(db);
        },
      });
      t("self reference", ({ db }) => {});
    `);
    expect(stderr).toContain('Fixture "db" depends on itself, but there is no earlier definition of "db"');
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("a non-destructured context parameter fails with a helpful error", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test } from "bun:test";
      const t = test.extend<{ db: number }>({ db: 1 });
      t("bad signature", (context) => {});
    `);
    expect(stderr).toContain("must use object destructuring");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("rest elements in the destructuring pattern fail with a helpful error", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test } from "bun:test";
      const t = test.extend<{ db: number }>({ db: 1 });
      t("rest", ({ ...rest }) => {});
    `);
    expect(stderr).toContain("Rest parameters are not supported");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("a destructured name that is not a fixture is undefined, even if Object.prototype has it", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test, expect } from "bun:test";
      Object.defineProperty(Object.prototype, "ghost", { value: "from the prototype", configurable: true });
      const t = test.extend<{ real: number }>({ real: 1 });
      t("context has no prototype", ({ real, ghost }: { real: number; ghost?: unknown }) => {
        expect(real).toBe(1);
        expect(ghost).toBeUndefined();
      });
    `);
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test("a bound fixture function fails the test instead of running without its dependencies", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test } from "bun:test";
      function makeDb(config: string, { port }: { port: number }, use: (db: string) => Promise<void>) {
        return use(config + ":" + port);
      }
      const t = test.extend<{ port: number; db: string }>({ port: 5432, db: makeDb.bind(null, "pg") });
      t("bound fixture", ({ db }) => {});
    `);
    expect(stderr).toContain(
      'TypeError: Fixture "db" is a bound or native function, so the fixtures it depends on cannot be read from its source.',
    );
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("fixtures are set up and torn down again for every retry and repeat", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test, expect } from "bun:test";
      let setups = 0;
      let attempts = 0;
      const t = test.extend<{ n: number }>({
        n: async ({}, use) => {
          setups++;
          await use(setups);
          console.error("event: teardown " + setups);
        },
      });
      t("retry gets a fresh fixture", ({ n }) => {
        attempts++;
        expect(n).toBe(attempts);
        if (attempts < 3) throw new Error("flaky");
      }, { retry: 5 });
      t("repeats get fresh fixtures", ({ n }) => {
        expect(n).toBe(setups);
      }, { repeats: 2 });
    `);
    // three attempts of the first test, then three runs of the second
    expect(events(stderr)).toEqual([
      "teardown 1",
      "teardown 2",
      "teardown 3",
      "teardown 4",
      "teardown 5",
      "teardown 6",
    ]);
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("extended test callbacks never receive a done callback", async () => {
    const { stderr, exitCode } = await runFixtureFile(`
      import { test, expect } from "bun:test";
      // A plain test with a parameter receives a done callback and would hang
      // until its timeout if it never called it; an extended test's parameter
      // is the fixture context instead.
      const t = test.extend({});
      t("context instead of done", context => {
        expect(context).toEqual({});
      });
    `);
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });
});
