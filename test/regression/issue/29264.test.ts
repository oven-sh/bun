import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/29264
//
// When a bundle plugin had an onResolve filter that matched one import but
// the same file also contained a non-external import that could not be
// resolved, the parse task finalized as an error without saving the parsed
// AST. A deferred onResolve plugin task later tried to read the importer's
// import_records from `graph.ast`, which was still at `JSAst.empty`, and
// crashed with "index out of bounds: index 0, len 0" (segfault in release).
test("#29264 bundler survives external + missing imports in same file", async () => {
  using dir = tempDir("29264", {
    "build-fixture.js": /* js */ `
      try {
        const res = await Bun.build({
          entrypoints: ["index.js"],
          plugins: [
            {
              name: "mark-bare-external",
              setup(build) {
                build.onResolve({ filter: /^[^.]/ }, () => ({ external: true }));
              },
            },
          ],
        });
        console.log("DONE:success=" + res.success);
      } catch (e) {
        console.log("DONE:caught");
        if (e && e.errors) {
          for (const err of e.errors) console.log("ERR:" + err.message);
        }
      }
    `,
    "index.js": /* js */ `
      import "src";
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

  // The fixture script must reach the `catch` and print DONE. Before
  // the fix, the process crashed inside `Bun.build` with a segfault
  // (release) or index-out-of-bounds panic (debug/ASAN), so neither
  // `DONE:` nor the per-error lines ever made it out. We deliberately
  // do NOT assert on the bare "src" import — whether the plugin's
  // `{ external: true }` (with no `path`) falls through to a resolver
  // error is plugin semantics, not what this test guards against.
  expect(stdout).toContain("DONE:caught");
  expect(stdout).toContain('ERR:Could not resolve: "./src"');
  expect(exitCode).toBe(0);
});
