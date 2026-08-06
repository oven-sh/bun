// moduleLoaderResolve short-circuits keys whose "ns:" prefix matches a
// registered onLoad namespace so the C++ loader doesn't re-resolve a key the
// plugin already produced. On Windows a single letter followed by ":" and a
// separator is a drive root ("C:\\..."), never a namespace, so such a key must
// still reach the filesystem resolver. Other platforms have no drive roots, so
// the prefix is the namespace, matching PluginRunner::extract_namespace.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

test("a single-letter namespace never captures a Windows drive root", async () => {
  using dir = tempDir("plugin-ns-drive-letter", {
    "preload.ts": `
      Bun.plugin({
        name: "single-letter-ns",
        setup(b) {
          for (const ns of ["c", "C"]) {
            b.onLoad({ filter: /.*/, namespace: ns }, () => ({
              contents: "export default 'from-plugin'",
              loader: "js",
            }));
          }
        },
      });
    `,
    // Static import of a non-existent absolute Windows path. moduleLoaderResolve
    // sees the literal "C:\\..." key.
    "uses-drive.mjs": `
      import x from "C:\\\\__definitely_missing__\\\\x.js";
      export default x;
    `,
    "entry.mjs": `
      try {
        console.log("loaded:" + (await import("./uses-drive.mjs")).default);
      } catch {
        console.log("rejected");
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload", "./preload.ts", "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim() || stderr).toBe(isWindows ? "rejected" : "loaded:from-plugin");
  expect(exitCode).toBe(0);
});
