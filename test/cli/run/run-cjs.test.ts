import { describe, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { join } from "path";

describe.concurrent("run-cjs", () => {
  test("running a commonjs module works", async () => {
    const dir = tmpdirSync();
    mkdirSync(dir, { recursive: true });
    await Bun.write(join(dir, "index1.js"), "module.exports = 1; console.log('hello world');");
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "index1.js")],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
    });
    const stdout = await proc.stdout.text();
    expect(stdout).toEqual("hello world\n");
  });

  test("a pre-bundled entry point still consults require.extensions", async () => {
    // `bun build --target=bun --format=cjs` emits this header, and the `// @bun`
    // pragma makes the parser hand the source straight to JSC without printing
    // it. That must not change how the modules this entry loads are resolved.
    using dir = tempDir("run-cjs-bundled-entry", {
      "entry.cjs": `// @bun @bun-cjs
(function(exports, require, module, __filename, __dirname) {
  require.extensions[".data"] = (module, filename) => {
    module.exports = "custom-loader";
  };
  console.log(require("./asset.data"));
})`,
      // If the custom loader is skipped, this is transpiled as JS/TS instead.
      "asset.data": `module.exports = "default-loader";`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.cjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toMatchObject({ stdout: "custom-loader\n", exitCode: 0 });
  });
});
