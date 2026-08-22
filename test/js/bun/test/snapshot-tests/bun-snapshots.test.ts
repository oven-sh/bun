import { describe, expect, it, test } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";

test("it will create a snapshot file if it doesn't exist", () => {
  expect({ a: { b: { c: false } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(Boolean) } } });
  expect({ a: { b: { c: "string" } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(String) } } });
  expect({ a: { b: { c: 4 } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(Number) } } });
  expect({ a: { b: { c: 2n } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(BigInt) } } });
  expect({ a: new Date() }).toMatchSnapshot({ a: expect.any(Date) });
  expect({ j: 2, a: "any", b: "any2" }).toMatchSnapshot({ j: expect.any(Number), a: "any", b: expect.any(String) });
  expect({ j: /regex/, a: "any", b: "any2" }).toMatchSnapshot({
    j: expect.any(RegExp),
    a: "any",
    b: expect.any(String),
  });
});

test("ArrayBuffer values are serialized like typed arrays", () => {
  expect(new Uint8Array([1, 2, 3]).buffer).toMatchInlineSnapshot(`
    ArrayBuffer [
      1,
      2,
      3,
    ]
  `);
  expect({ a: 1, b: new Uint8Array([4, 5]).buffer }).toMatchInlineSnapshot(`
    {
      "a": 1,
      "b": ArrayBuffer [
        4,
        5,
      ],
    }
  `);
});

describe("toMatchSnapshot errors", () => {
  it("should throw if property matchers exist and received is not an object", () => {
    expect(() => {
      expect(1).toMatchSnapshot({ a: 1 });
    }).toThrow();
  });
  it("should throw if property matchers don't match", () => {
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: 1 });
    }).toThrow();
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: expect.any(Date) });
    }).toThrow();
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: expect.any(String) });
    }).toThrow();
    expect(() => {
      expect({ a: 4n }).toMatchSnapshot({ a: expect.any(Number) });
    }).toThrow();
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: expect.any(BigInt) });
    }).toThrow();
  });
  it("should throw if arguments are in the wrong order", () => {
    expect(() => {
      // @ts-expect-error
      expect({ a: "oops" }).toMatchSnapshot("wrong spot", { a: "oops" });
    }).toThrow();
    expect(() => {
      expect({ a: "oops" }).toMatchSnapshot({ a: "oops" }, "right spot");
    }).not.toThrow();
  });

  it("should throw if expect.any() doesn't received a constructor", () => {
    expect(() => {
      // @ts-expect-error
      expect({ a: 4 }).toMatchSnapshot({ a: expect.any() });
    }).toThrow();
    expect(() => {
      // @ts-expect-error
      expect({ a: 5 }).toMatchSnapshot({ a: expect.any(5) });
    }).toThrow();
    expect(() => {
      // @ts-expect-error
      expect({ a: 4 }).toMatchSnapshot({ a: expect.any("not a constructor") });
    }).toThrow();
  });
});

describe("snapshots taken in hooks", () => {
  // Runs <dir>/hooks.test.ts and returns the `key = value` entries of the .snap file it wrote, in file order.
  async function runHooksFile(dir: string): Promise<{ exitCode: number; stderr: string; entries: string[] }> {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./hooks.test.ts"],
      env: { ...bunEnv, CI: "false" },
      cwd: dir,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const snap = await Bun.file(dir + "/__snapshots__/hooks.test.ts.snap").text();
    const entries = [...snap.matchAll(/^exports\[`(.*)`\] = `(.*)`;$/gm)].map(m => `${m[1]} = ${m[2]}`);
    return { exitCode, stderr, entries };
  }

  test.concurrent("beforeEach/afterEach/onTestFinished snapshots are named after the running test", async () => {
    using dir = tempDir("snapshot-hook-names", {
      "hooks.test.ts": /*js*/ `
        import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, onTestFinished, test } from "bun:test";
        beforeEach(() => expect("top").toMatchSnapshot("top beforeEach"));
        describe("outer", () => {
          beforeEach(() => expect("outer").toMatchSnapshot("outer beforeEach"));
          describe("inner", () => {
            beforeAll(() => expect("ba").toMatchSnapshot("beforeAll"));
            beforeEach(() => expect("inner").toMatchSnapshot("inner beforeEach"));
            beforeEach(() => expect("inline").toMatchInlineSnapshot('"inline"'));
            afterEach(() => expect("ae").toMatchSnapshot("afterEach"));
            afterAll(() => expect("aa").toMatchSnapshot("afterAll"));
            test("t1", () => {
              afterEach(() => expect("ae in test").toMatchSnapshot("afterEach in test"));
              onTestFinished(() => expect("otf").toMatchSnapshot("onTestFinished"));
              expect("body").toMatchSnapshot("body");
              expect("body").toMatchSnapshot();
            });
            test("t2", () => expect("body").toMatchSnapshot("body"));
          });
        });
      `,
    });
    const { exitCode, stderr, entries } = await runHooksFile(String(dir));
    expect(entries).toEqual([
      // beforeAll/afterAll do not run for a test, so they keep the hook's own (unnamed) key
      'outer inner (unnamed): beforeAll 1 = "ba"',
      'outer inner t1: top beforeEach 1 = "top"',
      'outer inner t1: outer beforeEach 1 = "outer"',
      'outer inner t1: inner beforeEach 1 = "inner"',
      'outer inner t1: body 1 = "body"',
      // the inline snapshot in beforeEach took number 1 of t1's unhinted counter, as in jest
      'outer inner t1 2 = "body"',
      'outer inner t1: afterEach in test 1 = "ae in test"',
      'outer inner t1: afterEach 1 = "ae"',
      'outer inner t1: onTestFinished 1 = "otf"',
      'outer inner t2: top beforeEach 1 = "top"',
      'outer inner t2: outer beforeEach 1 = "outer"',
      'outer inner t2: inner beforeEach 1 = "inner"',
      'outer inner t2: body 1 = "body"',
      'outer inner t2: afterEach 1 = "ae"',
      'outer inner (unnamed): afterAll 1 = "aa"',
    ]);
    expect(stderr).toContain(" 2 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  test.concurrent("per-test hooks share the test's counter, beforeAll/afterAll share the describe's", async () => {
    using dir = tempDir("snapshot-hook-counters", {
      "hooks.test.ts": /*js*/ `
        import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
        describe("d", () => {
          beforeAll(() => expect("ba").toMatchSnapshot("setup"));
          beforeEach(() => expect("be").toMatchSnapshot("setup"));
          afterEach(() => expect("ae").toMatchSnapshot("setup"));
          afterAll(() => expect("aa").toMatchSnapshot("setup"));
          test("t1", () => expect("body").toMatchSnapshot("setup"));
        });
      `,
    });
    const { exitCode, stderr, entries } = await runHooksFile(String(dir));
    expect(entries).toEqual([
      'd (unnamed): setup 1 = "ba"',
      'd t1: setup 1 = "be"',
      'd t1: setup 2 = "body"',
      'd t1: setup 3 = "ae"',
      'd (unnamed): setup 2 = "aa"',
    ]);
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  test.concurrent("adding a test does not invalidate the hook snapshots of the other tests", async () => {
    const source = (extraTest: string) => /*js*/ `
      import { afterEach, describe, expect, test } from "bun:test";
      let value;
      describe("d", () => {
        afterEach(() => expect(value).toMatchSnapshot("afterEach"));
        ${extraTest}
        test("t1", () => { value = "from t1"; });
        test("t2", () => { value = "from t2"; });
      });
    `;
    using dir = tempDir("snapshot-hook-stability", { "hooks.test.ts": source("") });
    const first = await runHooksFile(String(dir));
    expect(first.entries).toEqual(['d t1: afterEach 1 = "from t1"', 'd t2: afterEach 1 = "from t2"']);
    expect(first.exitCode).toBe(0);

    writeFileSync(String(dir) + "/hooks.test.ts", source(`test("t0", () => { value = "from t0"; });`));
    const second = await runHooksFile(String(dir));
    expect(second.stderr).toContain(" 3 pass");
    expect(second.stderr).toContain(" 0 fail");
    expect(second.entries).toEqual([
      'd t1: afterEach 1 = "from t1"',
      'd t2: afterEach 1 = "from t2"',
      'd t0: afterEach 1 = "from t0"',
    ]);
    expect(second.exitCode).toBe(0);
  });
});
