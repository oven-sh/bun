import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Spawned in a subprocess so require.cache / require.extensions start clean
// and the overridden .json handler can't leak into the test runner's own
// module loading.
test("require.cache[key].loaded is true after a custom extension handler runs", async () => {
  using dir = tempDir("require-extensions-loaded", {
    "package.json": JSON.stringify({ type: "commonjs" }),
    "cfg.json": "{}",
    "a.xyz": "ignored",
    "bad.abc": "ignored",
    "main.cjs": `
      const path = require("path");
      const jsonKey = require.resolve("./cfg.json");
      const xyzKey = require.resolve("./a.xyz");
      const abcKey = path.resolve(__dirname, "bad.abc");

      require.extensions[".json"] = function (m, f) {
        m.exports = { x: 1, loadedDuring: m.loaded };
      };
      require.extensions[".xyz"] = function (m, f) {
        m._compile("module.exports = { y: 2 };", f);
      };
      require.extensions[".abc"] = function (m, f) {
        throw new Error("boom");
      };

      const jsonExports = require(jsonKey);
      const xyzExports = require(xyzKey);

      let abcThrew = false;
      try {
        require(abcKey);
      } catch {
        abcThrew = true;
      }

      console.log(
        JSON.stringify({
          jsonExports,
          jsonLoaded: require.cache[jsonKey].loaded,
          xyzExports,
          xyzLoaded: require.cache[xyzKey].loaded,
          abcThrew,
          abcCached: abcKey in require.cache,
        }),
      );
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    jsonExports: { x: 1, loadedDuring: false },
    jsonLoaded: true,
    xyzExports: { y: 2 },
    xyzLoaded: true,
    abcThrew: true,
    abcCached: false,
  });
  expect(exitCode).toBe(0);
});
