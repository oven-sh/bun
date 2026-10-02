import { beforeAll, describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";

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

// A snapshot is named after the test that was running when expect() was called. These cover
// the error reported when that test cannot name a snapshot by the time the matcher runs.
describe("snapshot matchers on an expect() that has no running test", () => {
  const finishedMessage = "Snapshot matchers are not supported after the test has finished executing";
  const outsideTestMessage = "Snapshot matchers cannot be used outside of a test";
  const concurrentMessage = "Snapshot matchers are not supported in concurrent tests";

  describe("expect() created in a describe callback", () => {
    let error: unknown;
    try {
      expect("described").toMatchSnapshot();
    } catch (e) {
      error = e;
    }

    it("throws the outside-of-a-test error", () => {
      expect((error as Error).message).toBe(outsideTestMessage);
    });
  });

  describe("expect() created in a beforeAll that has since finished", () => {
    let value: ReturnType<typeof expect>;
    let thrower: ReturnType<typeof expect>;
    let inline: ReturnType<typeof expect>;

    beforeAll(() => {
      value = expect({ created: "in beforeAll" });
      thrower = expect(() => {
        throw new Error("created in beforeAll");
      });
      inline = expect("created in beforeAll");
    });

    it("toMatchSnapshot throws the finished-test error", () => {
      expect(() => value.toMatchSnapshot()).toThrow(finishedMessage);
      expect(() => value.toMatchSnapshot("with hint")).toThrow(finishedMessage);
    });

    it("toThrowErrorMatchingSnapshot throws the finished-test error", () => {
      expect(() => thrower.toThrowErrorMatchingSnapshot()).toThrow(finishedMessage);
    });

    it("inline snapshots are keyed by source location and still work", () => {
      inline.toMatchInlineSnapshot(`"created in beforeAll"`);
    });
  });

  describe.concurrent("expect() created in a concurrent group", () => {
    for (const name of ["first", "second"]) {
      it(`${name} test throws the concurrent error`, async () => {
        expect(() => expect(name).toMatchSnapshot()).toThrow(concurrentMessage);
      });
    }
  });

  it.concurrent("expect() from a timed out test throws the finished-test error and writes nothing", async () => {
    using dir = tempDir("snapshot-after-timeout", {
      "timeout.test.ts": `
        import { expect, test } from "bun:test";

        const nextTestStarted = Promise.withResolvers<void>();
        const lateMatcherRan = Promise.withResolvers<void>();

        test("times out", async () => {
          const captured = expect({ from: "times out" });
          // Only "next" resolves this, so this test has always timed out by the time it continues.
          await nextTestStarted.promise;
          try {
            captured.toMatchSnapshot();
            console.log("late toMatchSnapshot: did not throw");
          } catch (error) {
            console.log("late toMatchSnapshot:", (error as Error).message);
          }
          lateMatcherRan.resolve();
        }, 1);

        test("next", async () => {
          nextTestStarted.resolve();
          await lateMatcherRan.promise;
          expect({ from: "next" }).toMatchSnapshot();
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "timeout.test.ts"],
      cwd: String(dir),
      env: { ...bunEnv, CI: "false" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun test <version> (<revision>)
      late toMatchSnapshot: Snapshot matchers are not supported after the test has finished executing"
    `);
    expect(stderr).toContain("this test timed out after 1ms");
    expect(stderr).toContain("(pass) next");
    expect(stderr).toContain("snapshots: +1 added");
    expect(await Bun.file(join(String(dir), "__snapshots__", "timeout.test.ts.snap")).text()).toBe(
      '// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n\nexports[`next 1`] = `\n{\n  "from": "next",\n}\n`;\n',
    );
    expect(exitCode).toBe(1);
  });

  it.concurrent("expect() created in a test file that has finished throws the finished-test error", async () => {
    using dir = tempDir("snapshot-after-file", {
      "shared.ts": `
        import type { expect } from "bun:test";
        export const captured: { value?: ReturnType<typeof expect>; thrower?: ReturnType<typeof expect> } = {};
      `,
      "1-create.test.ts": `
        import { expect, test } from "bun:test";
        import { captured } from "./shared";

        test("creates", () => {
          captured.value = expect({ from: "1-create" });
          captured.thrower = expect(() => {
            throw new Error("from 1-create");
          });
        });
      `,
      "2-use.test.ts": `
        import { expect, test } from "bun:test";
        import { captured } from "./shared";

        test("uses", () => {
          for (const [name, matcher] of [
            ["toMatchSnapshot", () => captured.value!.toMatchSnapshot()],
            ["toThrowErrorMatchingSnapshot", () => captured.thrower!.toThrowErrorMatchingSnapshot()],
          ] as const) {
            try {
              matcher();
              console.log(name + ": did not throw");
            } catch (error) {
              console.log(name + ": " + (error as Error).message);
            }
          }
          expect({ from: "2-use" }).toMatchSnapshot();
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./1-create.test.ts", "./2-use.test.ts"],
      cwd: String(dir),
      env: { ...bunEnv, CI: "false" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun test <version> (<revision>)
      toMatchSnapshot: expect(received).toMatchSnapshot()

      Matcher error: Snapshot matchers are not supported after the test has finished executing

      toThrowErrorMatchingSnapshot: expect(received).toThrowErrorMatchingSnapshot()

      Matcher error: Snapshot matchers are not supported after the test has finished executing"
    `);
    expect(stderr).toContain("snapshots: +1 added");
    expect(readdirSync(join(String(dir), "__snapshots__"))).toEqual(["2-use.test.ts.snap"]);
    expect(await Bun.file(join(String(dir), "__snapshots__", "2-use.test.ts.snap")).text()).toBe(
      '// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n\nexports[`uses 1`] = `\n{\n  "from": "2-use",\n}\n`;\n',
    );
    expect(exitCode).toBe(0);
  });
});
