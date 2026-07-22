import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/29264
test("#29264 bundler survives external + missing imports in same file", { timeout: 30_000 }, async () => {
  using dir = tempDir("issue-29264", {
    "build-fixture.js": /* js */ `
      try {
        await Bun.build({
          entrypoints: ["index.js"],
          plugins: [
            {
              name: "mark-bare-external",
              setup(build) {
                build.onResolve({ filter: /^[^.]/ }, args => {
                  if (args.kind === "entry-point-build") return;
                  if (args.path === "src") return { external: true };
                  // "other": fall through to NoMatch -> run_resolver so the
                  // unchecked import_records[..] access there is still
                  // exercised against the error-path store (#29264).
                });
              },
            },
          ],
        });
        console.log("DONE:ok");
      } catch (e) {
        console.log("DONE:caught");
        if (e && e.errors) {
          for (const err of e.errors) console.log("ERR:" + err.message);
        }
      }
    `,
    "index.js": /* js */ `
      import "src";
      import "other";
      import "./src";
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build-fixture.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Before the fix, the child crashed in Bun.build — segfault (release) or
  // index-out-of-bounds panic (debug/ASAN) — so "DONE:caught" never printed.
  const combined = stdout + stderr;
  expect(combined).toContain("DONE:caught");
  expect(combined).toContain('Could not resolve: "./src"');
  expect(combined).toContain('Could not resolve: "other"');
  expect(exitCode).toBe(0);
});
