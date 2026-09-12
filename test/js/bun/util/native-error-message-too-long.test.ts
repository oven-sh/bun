// Errors built from a natively formatted message that is longer than the
// string length limit. The error object must still be created, with a stand-in
// message: it used to come back as an empty value, so a failing expect() was
// reported as passing, and the process crashed when the creator then set
// properties on it or when JS touched the thrown value.
//
// Each case runs in its own process: setSyntheticAllocationLimitForTesting is
// process-wide (floor 1 MiB), and the unfixed cases crash.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const FALLBACK = "The error message exceeds the maximum string length";
const LIMIT = 1024 * 1024;

// Shared by every fixture: lowers the limit, and `caught(fn)` reports what `fn`
// throws. Fixtures print one JSON line, which `run` returns as `report`.
const prelude = /* ts */ `
import { setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
setSyntheticAllocationLimitForTesting(${LIMIT});
const LIMIT = ${LIMIT};
async function caught(fn) {
  try {
    await fn();
  } catch (e) {
    return { name: e.name, message: e.message };
  }
  return "did not throw";
}
`;

async function run(files: Record<string, string>, ...cmd: string[]) {
  using dir = tempDir("native-error-too-long", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // `bun test` prints its version banner to stdout ahead of the fixture's line.
  // A crashed fixture prints nothing; report the whole run instead so the
  // assertion failure shows what happened.
  const line = stdout.split("\n").find(l => l.startsWith("{") || l.startsWith("["));
  const report = line ? JSON.parse(line) : { stdout, stderr, exitCode };
  return { report, stderr, exitCode };
}

describe.concurrent("native error whose message exceeds the string length limit", () => {
  test("failing expect() throws an Error and bun test reports the failure", async () => {
    const { report, stderr, exitCode } = await run(
      {
        "fixture.test.ts": /* ts */ `
          ${prelude}
          import { expect, test } from "bun:test";

          // expect(value, label) starts the failure message with the label verbatim,
          // so the message is label.length + suffix characters long.
          const suffix = (await caught(() => expect(1, "L").toBe(2))).message.length - 1;
          const longest = Buffer.alloc(LIMIT - suffix, "a").toString();
          const tooLong = Buffer.alloc(LIMIT - suffix + 1, "a").toString();
          // Fits in a string by itself; the failure message quoting it does not.
          const big = Buffer.alloc(LIMIT - 16, "a").toString();

          const results = {};
          test("message exactly at the limit is kept", async () => {
            const { name, message } = await caught(() => expect(1, longest).toBe(2));
            results.atLimit = { name, length: message.length, startsWithLabel: message.startsWith(longest) };
          });
          test("message one past the limit", async () => {
            results.onePast = await caught(() => expect(1, tooLong).toBe(2));
          });
          test("rendered received value takes the message past the limit", async () => {
            results.renderedValue = await caught(() => expect(() => big).toThrow());
            console.log(JSON.stringify(results));
          });
          test("uncaught", () => {
            expect(1, tooLong).toBe(2);
          });
        `,
      },
      "test",
      "fixture.test.ts",
    );

    expect(report).toEqual({
      atLimit: { name: "Error", length: LIMIT, startsWithLabel: true },
      onePast: { name: "Error", message: FALLBACK },
      renderedValue: { name: "Error", message: FALLBACK },
    });
    expect(stderr).toContain(`error: ${FALLBACK}`);
    expect(stderr).toContain("(fail) uncaught");
    expect(stderr).toContain(" 3 pass\n");
    expect(stderr).toContain(" 1 fail\n");
    expect(exitCode).toBe(1);
  });

  test("Bun.listen, which sets properties on the error before throwing it, throws instead of crashing", async () => {
    const { report, exitCode } = await run(
      {
        "listen.ts": /* ts */ `
          ${prelude}
          const unix = Buffer.alloc(LIMIT - 16, "a").toString();
          console.log(JSON.stringify(await caught(() => Bun.listen({ unix, socket: { data() {} } }))));
        `,
      },
      "listen.ts",
    );

    expect(report).toEqual({ name: "Error", message: FALLBACK });
    expect(exitCode).toBe(0);
  });

  test("SyntaxError from Bun.JSONC.parse keeps its type and gets the fallback message", async () => {
    const { report, exitCode } = await run(
      {
        "jsonc.ts": /* ts */ `
          ${prelude}
          const big = Buffer.alloc(LIMIT - 16, "a").toString();
          console.log(JSON.stringify([await caught(() => Bun.JSONC.parse(big)), await caught(() => Bun.JSONC.parse("bbb"))]));
        `,
      },
      "jsonc.ts",
    );

    expect(report).toEqual([
      { name: "SyntaxError", message: FALLBACK },
      { name: "SyntaxError", message: "JSONC Parse error: Unexpected bbb" },
    ]);
    expect(exitCode).toBe(0);
  });
});
