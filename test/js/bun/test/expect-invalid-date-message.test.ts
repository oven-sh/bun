// Failure messages for Invalid Date must print "Invalid Date".
// JSON.stringify(new Date(NaN)) is `null` (unquoted), and the quote-trimming
// pass used to slice it down to the garbage string "ul".

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("expect() failure messages render Invalid Date, not a sliced 'null'", async () => {
  using dir = tempDir("expect-invalid-date", {
    "invalid-date.test.ts": `
      import { test, expect } from "bun:test";
      test("invalid date vs valid date", () => {
        expect(new Date(NaN)).toEqual(new Date(0));
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "invalid-date.test.ts"],
    env: { ...bunEnv, NO_COLOR: "1", FORCE_COLOR: undefined },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Expected: 1970-01-01T00:00:00.000Z");
  expect(stderr).toContain("Received: Invalid Date");
  expect(exitCode).toBe(1);
});
