// https://github.com/oven-sh/bun/issues/33180
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A plain (no top-level await) ESM module must stay require()-able while a
// concurrent static import is still fetching it off-thread. The target is large
// so its transpile reliably overlaps the tiny CommonJS sibling's require().
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

// Independent attempts (separate temp dirs + child processes, nothing shared);
// without the fix the race throws the false "async module" error on essentially
// every debug run, so any attempt suffices.
for (let attempt = 0; attempt < 4; attempt++) {
  test.concurrent(
    `require(esm) racing a concurrent static import loads synchronously (attempt ${attempt})`,
    async () => {
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
    },
  );
}
