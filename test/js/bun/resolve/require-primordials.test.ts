import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The CommonJS loader decides "built-in module?" and "native addon?" from the
// resolved id. Those checks must not run through the user-visible
// String.prototype methods: a patched endsWith() would hand a plain .cjs file
// to dlopen, and a patched startsWith() would break require("node:*").
test("require() dispatch ignores patched String.prototype.startsWith/endsWith", async () => {
  using dir = tempDir("require-primordials", {
    "m.cjs": 'module.exports = "cjs-ok";',
    "fixture.js": `
      const origEndsWith = String.prototype.endsWith;
      const origStartsWith = String.prototype.startsWith;
      String.prototype.endsWith = function (search, ...rest) {
        return search === ".node" ? true : origEndsWith.call(this, search, ...rest);
      };
      String.prototype.startsWith = function (search, ...rest) {
        return search === "node:" ? false : origStartsWith.call(this, search, ...rest);
      };
      let out;
      try {
        out = { cjs: require("./m.cjs"), builtin: typeof require("node:fs").readFileSync, bare: typeof require("fs").statSync };
      } catch (err) {
        out = { error: err.message };
      }
      String.prototype.endsWith = origEndsWith;
      String.prototype.startsWith = origStartsWith;
      console.log(JSON.stringify(out));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ cjs: "cjs-ok", builtin: "function", bare: "function" });
  expect(exitCode).toBe(0);
});
