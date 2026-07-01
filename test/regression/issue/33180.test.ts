// https://github.com/oven-sh/bun/issues/33180
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A plain ESM module (no top-level await) that is statically imported while a
// sibling CommonJS module require()s it must load successfully. The static
// import kicks off a concurrent transpiler-thread fetch; the require() lands
// while that fetch is still in flight. loadModuleSync used to reuse the pending
// async fetch promise instead of forcing a synchronous fetch, so require()
// wrongly reported the plain module as an unsupported async module. The module
// body here is large enough that its off-thread transpile is reliably still
// running when the tiny CommonJS sibling evaluates.
function makeTarget() {
  let src = "";
  for (let i = 0; i < 1000; i++) src += `export const v${i} = ${i};\n`;
  src += `export const val = 42;\n`;
  src += `export function getVal() { return val; }\n`;
  return src;
}

const files = {
  "target.mjs": makeTarget(),
  "cjs-req.cjs": `
    const t = require("./target.mjs");
    if (t.val !== 42 || t.getVal() !== 42) {
      console.error("half-initialized namespace: val=" + t.val);
      process.exit(3);
    }
    console.log("required-ok");
    module.exports = {};
  `,
  "entry.mjs": `
    import "./target.mjs";
    import "./cjs-req.cjs";
    console.log("entry-done");
  `,
};

// Several independent attempts: without the fix the race reports the false
// "async module" error on essentially every run of a debug build, so any one
// attempt failing is enough. Each attempt is its own test so a single spawn
// stays well under the default timeout.
for (let attempt = 0; attempt < 4; attempt++) {
  test(`require(esm) racing a concurrent static import loads synchronously (attempt ${attempt})`, async () => {
    using dir = tempDir("issue-33180", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("async module");
    expect(stdout).toContain("required-ok");
    expect(stdout).toContain("entry-done");
    expect(exitCode).toBe(0);
  });
}
