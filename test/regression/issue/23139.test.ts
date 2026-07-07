// https://github.com/oven-sh/bun/issues/23139
//
// Dynamically importing a file that fails to parse threw on the first
// `await import()`, but the *second* `await import()` of the same path
// hung forever instead of re-throwing — the rejected module-registry
// entry was never re-queried. Fixed somewhere in the WebKit
// module-loader rewrite window (oven-sh/bun#29393 → #30262); reproduces
// on 1.3.13, gone on main with WebKit 88b2f7a2 (i.e. before #30527).
// This test pins it.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("repeated dynamic import of a file that fails to parse re-throws instead of hanging", async () => {
  using dir = tempDir("issue-23139", {
    "bad.json": `{ "invalid": json }`,
    "entry.ts": `
      for (const attempt of [1, 2]) {
        try {
          await import("./bad.json");
          console.log("attempt " + attempt + ": resolved (unexpected)");
        } catch (e) {
          console.log("attempt " + attempt + ": threw " + (e as Error).name);
        }
      }
      console.log("done");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    // Before the fix the second import never settles, so bound the
    // subprocess and assert on signalCode rather than letting the test
    // itself time out.
    timeout: 10_000,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("attempt 1: threw SyntaxError\nattempt 2: threw SyntaxError\ndone\n");
  if (exitCode !== 0) expect(stderr).toBe("");
  // null ⇒ exited on its own; non-null ⇒ killed by the spawn timeout (hung).
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
}, 30_000);
