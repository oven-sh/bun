// https://github.com/oven-sh/bun/issues/22743
//
// Regressed 1.2.20 → 1.2.21: dynamic-importing path X that throws,
// then a *different* error-throwing path Y, then X again — the third
// `await import(X)` hung instead of re-throwing. Same already-settled
// module-registry-entry re-entry as #23139, just with the X/Y/X
// interleave that the original repro hit via two distinct https URLs.
// Fixed in the module-loader rewrite window (#29393 → #30262); this
// test pins the network-free reduction.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("re-importing an error-throwing module after a different error-throwing import re-throws instead of hanging", async () => {
  using dir = tempDir("issue-22743", {
    "bad1.json": `{ "a": nope }`,
    "bad2.json": `{ "b": also nope }`,
    "entry.ts": `
      // Original repro used two https:// URLs (which Bun rejects without
      // a network call); two unparseable JSON files give the same
      // throws-on-load shape without depending on the https-import error
      // message staying stable.
      const seq = ["./bad1.json", "./bad2.json", "./bad1.json"];
      for (const [i, p] of seq.entries()) {
        try {
          await import(p);
          console.log("import " + (i + 1) + ": resolved (unexpected)");
        } catch (e) {
          console.log("import " + (i + 1) + ": threw " + (e as Error).name);
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
    // Pre-fix the third import never settles; bound the subprocess so the
    // assertions report a clear diff instead of the test itself timing out.
    timeout: 10_000,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("import 1: threw SyntaxError\nimport 2: threw SyntaxError\nimport 3: threw SyntaxError\ndone\n");
  if (exitCode !== 0) expect(stderr).toBe("");
  // null ⇒ exited on its own; non-null ⇒ killed by the spawn timeout (hung).
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
}, 30_000);
