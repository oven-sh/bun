import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("accessing Bun.$ after stack overflow from recursive constructor does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
delete globalThis.Loader;
Bun.generateHeapSnapshot = console.profile = console.profileEnd = process.abort = () => {};
const v2 = { maxByteLength: 875 };
const v4 = new ArrayBuffer(875, v2);
try { v4.resize(875); } catch (e) {}
new BigUint64Array(v4);
function F8(a10, a11, a12, a13) {
    if (!new.target) { throw 'must be called with new'; }
    const v14 = this?.constructor;
    try { new v14(a12, v4, v2, v2); } catch (e) {}
    Bun.$;
}
new F8(F8, v4, v2, BigUint64Array);
try {
} catch(e19) {
}
const v20 = {};
Bun.gc(true);
`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("runtime error");
  expect(exitCode).toBe(0);
});
