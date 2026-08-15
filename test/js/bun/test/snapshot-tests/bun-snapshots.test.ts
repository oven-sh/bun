import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
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

// A snapshot's name comes from the test that was running when expect() was called.
// These cover the cases where that test cannot name a snapshot by the time the matcher runs.
describe("snapshot matchers on an expect() created outside of a running test", () => {
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

  describe("expect() created in a test that has since finished", () => {
    let value: ReturnType<typeof expect>;
    let thrower: ReturnType<typeof expect>;
    let inline: ReturnType<typeof expect>;

    it("creates the expect() objects", () => {
      value = expect({ created: "in the previous test" });
      thrower = expect(() => {
        throw new Error("created in the previous test");
      });
      inline = expect("created in the previous test");
    });

    it("toMatchSnapshot throws the finished-test error", () => {
      expect(() => value.toMatchSnapshot()).toThrow(finishedMessage);
      expect(() => value.toMatchSnapshot("with hint")).toThrow(finishedMessage);
    });

    it("toThrowErrorMatchingSnapshot throws the finished-test error", () => {
      expect(() => thrower.toThrowErrorMatchingSnapshot()).toThrow(finishedMessage);
    });

    it("inline snapshots are keyed by source location and still work", () => {
      inline.toMatchInlineSnapshot(`"created in the previous test"`);
    });
  });

  describe.concurrent("expect() created in a concurrent group", () => {
    for (const name of ["first", "second"]) {
      it(`${name} test throws the concurrent error`, async () => {
        expect(() => expect(name).toMatchSnapshot()).toThrow(concurrentMessage);
      });
    }
  });

  it("expect() created in a test that timed out throws the finished-test error and writes nothing", async () => {
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

    expect(normalizeBunSnapshot(stdout)).toBe(
      `bun test <version> (<revision>)\nlate toMatchSnapshot: ${finishedMessage}`,
    );
    expect(stderr).toContain("this test timed out after 1ms");
    expect(stderr).toContain("(pass) next");
    expect(stderr).toContain("snapshots: +1 added");
    expect(await Bun.file(join(String(dir), "__snapshots__", "timeout.test.ts.snap")).text()).toBe(
      '// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n\nexports[`next 1`] = `\n{\n  "from": "next",\n}\n`;\n',
    );
    expect(exitCode).toBe(1);
  });
});
