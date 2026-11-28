// moduleLoaderResolve short-circuits keys whose "ns:" prefix matches a
// registered onLoad namespace so the C++ loader doesn't re-resolve a key the
// plugin already produced. A single-letter prefix like "C:" is a Windows
// drive, never a plugin namespace; resolving "C:\\..." with a one-letter
// namespace registered must still reach the filesystem resolver.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join, toNamespacedPath } from "node:path";
import { unsupported as aotUnsupported } from "../../../aot/supported";

test.skipIf(!isWindows || !!aotUnsupported)(
  "compiled executables refuse namespaced addons outside the image",
  async () => {
    using dir = tempDir("compiled-namespaced-addon", {
      "addon.node": "native addon fixture",
      "main.ts": `
      const filename: string = process.argv[2];
      try {
        require(filename);
        console.log("loaded");
      } catch (error: any) {
        console.log(error.code, error.message.includes("only runs code that was compiled into it"));
      }
    `,
    });
    const executable = join(String(dir), "app.exe");
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [buildOut, buildError, buildExit] = await Promise.all([
      build.stdout.text(),
      build.stderr.text(),
      build.exited,
    ]);
    expect({ buildOut: buildExit ? buildOut : "", buildError: buildExit ? buildError : "", buildExit }).toEqual({
      buildOut: "",
      buildError: "",
      buildExit: 0,
    });
    const filename = toNamespacedPath(join(String(dir), "addon.node"));
    for (const key of [filename, filename.replaceAll("\\", "/")]) {
      await using proc = Bun.spawn({
        cmd: [executable, key],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "MODULE_NOT_FOUND true\n", stderr: "", exitCode: 0 });
    }
  },
);

test("single-letter plugin namespace does not capture Windows drive paths", async () => {
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
    // sees the literal "C:\\..." key; the short-circuit must not treat the
    // single-letter "C" prefix as the registered plugin namespace.
    "uses-drive.mjs": `
      import x from "C:\\\\__definitely_missing__\\\\x.js";
      export default x;
    `,
    "entry.mjs": `
      try {
        await import("./uses-drive.mjs");
        console.log("imported");
      } catch (e) {
        console.log("rejected:" + (e && e.constructor && e.constructor.name));
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
  // Must NOT have produced "imported".
  expect(stdout.trim().startsWith("rejected:")).toBe(true);
  expect(stdout).not.toContain("imported");
  expect(exitCode).toBe(0);
  void stderr;
});

test.skipIf(!isWindows)("Windows namespace prefixes survive plugin importer query stripping", async () => {
  using dir = tempDir("plugin-device-prefix", {
    "parent.cjs": 'module.exports = require("./namespace-child.js");',
    "entry.cjs": `
      const assert = require("node:assert/strict");
      const { join, toNamespacedPath } = require("node:path");
      const importers = [];
      Bun.plugin({
        name: "namespace-importers",
        setup(build) {
          build.onResolve({ filter: /namespace-child\\.js$/ }, ({ importer }) => {
            importers.push(importer);
            return { path: "child", namespace: "namespace-importers" };
          });
          build.onLoad({ filter: /.*/, namespace: "namespace-importers" }, () => ({
            exports: { value: 42 }, loader: "object",
          }));
        },
      });
      const plain = join(process.cwd(), "parent.cjs");
      const namespaced = toNamespacedPath(plain);
      for (const key of [plain, plain + "?query", namespaced, namespaced + "?query"]) {
        assert.equal(require(key).value, 42);
      }
      assert.deepEqual(importers, [plain, plain, namespaced, namespaced]);
      console.log("ok");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
});
