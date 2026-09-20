/**
 * scripts/runner.node.ts reads `skipTests` in test/vendor.json to decide which vendored
 * test files it does not run, and which tests it leaves out of a file it does run.
 * scripts/vendor-skips.ts holds both decisions.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { getVendorTestArgs, isVendorTestSkipped, type VendorSkipTests } from "../../scripts/vendor-skips.ts";
import vendors from "../vendor.json";

const skipTests: VendorSkipTests = {
  "ws*connection.test.ts": "reason",
  "core*stop.test.ts": true,
  "a*b.test.ts": false,
  "response*stream.test.ts": { tests: ["stop stream on canceled request", "a+b (c)"], reason: "reason" },
  "response*.test.ts": { tests: ["every response file"], reason: "reason" },
};

describe("isVendorTestSkipped", () => {
  test("a string or true skips the file, a falsy value or { tests } does not", () => {
    expect({
      string: isVendorTestSkipped(skipTests, "ws/connection.test.ts"),
      backslash: isVendorTestSkipped(skipTests, "ws\\connection.test.ts"),
      true: isVendorTestSkipped(skipTests, "core/stop.test.ts"),
      false: isVendorTestSkipped(skipTests, "a/b.test.ts"),
      tests: isVendorTestSkipped(skipTests, "response/stream.test.ts"),
      unlisted: isVendorTestSkipped(skipTests, "ws/message.test.ts"),
      longerName: isVendorTestSkipped(skipTests, "ws/connection.test.tsx"),
    }).toEqual({
      string: true,
      backslash: true,
      true: true,
      false: false,
      tests: false,
      unlisted: false,
      longerName: false,
    });
  });

  test("a boolean applies to every file, and no skipTests skips nothing", () => {
    expect([true, false, undefined].map(value => isVendorTestSkipped(value, "a.test.ts"))).toEqual([
      true,
      false,
      false,
    ]);
  });
});

describe("getVendorTestArgs", () => {
  test("a file with no { tests } entry gets no arguments", () => {
    expect({
      skippedFile: getVendorTestArgs(skipTests, "ws/connection.test.ts"),
      unlisted: getVendorTestArgs(skipTests, "ws/message.test.ts"),
      boolean: getVendorTestArgs(true, "a.test.ts"),
      undefined: getVendorTestArgs(undefined, "a.test.ts"),
    }).toEqual({ skippedFile: [], unlisted: [], boolean: [], undefined: [] });
  });

  test("the pattern matches every test name that contains none of the skipped ones", () => {
    const [flag, pattern, ...rest] = getVendorTestArgs(skipTests, "response\\stream.test.ts");
    expect({ flag, rest }).toEqual({ flag: "--test-name-pattern", rest: ["--pass-with-no-tests"] });
    const selects = (name: string) => new RegExp(pattern!).test(name);
    expect({
      skipped: selects("Stream stop stream on canceled request"),
      escaped: selects("Stream a+b (c)"),
      fromTheOtherGlob: selects("every response file"),
      unescapedWouldMatch: selects("Stream aab c"),
      other: selects("Stream handle stream"),
    }).toEqual({ skipped: false, escaped: false, fromTheOtherGlob: false, unescapedWouldMatch: true, other: true });
  });

  async function runStreamFixture(skipped: string[]) {
    using dir = tempDir("runner-vendor-skips", {
      "stream.test.ts": `
        import { describe, expect, it } from "bun:test";
        describe("Stream", () => {
          it("handle stream", () => expect(1).toBe(1));
          it("stop stream on canceled request", () => expect(1).toBe(2));
          it("a+b (c)", () => expect(1).toBe(2));
        });
      `,
    });
    const args = getVendorTestArgs({ "stream.test.ts": { tests: skipped, reason: "reason" } }, "stream.test.ts");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args, "stream.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stderr, exitCode };
  }

  test.concurrent("bun test runs the file without the skipped tests", async () => {
    const { stderr, exitCode } = await runStreamFixture(["stop stream on canceled request", "a+b (c)"]);
    expect(stderr.match(/^ *\d+ (?:pass|fail|filtered out)$/gm)?.map(line => line.trim())).toEqual([
      "1 pass",
      "2 filtered out",
      "0 fail",
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a file with no test left passes, as a skipped file does", async () => {
    const { stderr, exitCode } = await runStreamFixture(["Stream"]);
    expect(stderr).toContain("matched 0 tests");
    expect(exitCode).toBe(0);
  });
});

describe("test/vendor.json", () => {
  const entries = (vendors as { skipTests?: VendorSkipTests }[]).flatMap(({ skipTests }) =>
    typeof skipTests === "object"
      ? Object.entries(skipTests).flatMap(([glob, skip]) =>
          skip && typeof skip === "object" ? [{ glob, skip, skipTests }] : [],
        )
      : [],
  );

  test("the { tests } skips give these arguments, and their files still run", () => {
    expect(
      entries.map(({ glob, skipTests }) => {
        const path = glob.replaceAll("*", "/");
        return { glob, skipsFile: isVendorTestSkipped(skipTests, path), args: getVendorTestArgs(skipTests, path) };
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "args": [
            "--test-name-pattern",
            "^(?!.*(?:stop stream on canceled request))",
            "--pass-with-no-tests",
          ],
          "glob": "response*stream.test.ts",
          "skipsFile": false,
        },
      ]
    `);
  });

  test("each { tests } skip gives a reason and names tests the way bun test matches them", () => {
    // A blank name is in every test name, so it leaves the whole file out. bun test matches
    // the names joined by a space, so a name copied from the reporter ("Stream > stop
    // stream") matches nothing.
    expect(
      entries.map(({ glob, skip }) => ({
        glob,
        hasReason: typeof skip.reason === "string" && /\S/.test(skip.reason),
        hasTests: skip.tests.length > 0,
        badNames: skip.tests.filter(name => !/\S/.test(name) || name.includes(" > ")),
      })),
    ).toEqual(entries.map(({ glob }) => ({ glob, hasReason: true, hasTests: true, badNames: [] })));
  });
});
