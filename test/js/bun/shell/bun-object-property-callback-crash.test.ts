import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test: accessing Bun lazy properties (which use PropertyCallback)
// during/after stack overflow must not crash. PropertyCallback handlers that
// returned an empty JSValue on exception caused a null pointer dereference in
// JSC's reifyStaticProperty → putDirect → isGetterSetter() path.

test("accessing Bun.$ during stack overflow recovery does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
function F8(a10, a11, a12, a13) {
    if (!new.target) { throw 'must be called with new'; }
    const v14 = this?.constructor;
    try { new v14(a12, a10, a11, a13); } catch (e) {}
    try { Bun.$; } catch(e) {}
}
try { new F8(F8, {}, {}, {}); } catch(e) {}
Bun.gc(true);
console.log("OK");
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("runtime error");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});

test("accessing Bun.sql during stack overflow recovery does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
function F8(a10, a11, a12, a13) {
    if (!new.target) { throw 'must be called with new'; }
    const v14 = this?.constructor;
    try { new v14(a12, a10, a11, a13); } catch (e) {}
    try { Bun.sql; } catch(e) {}
}
try { new F8(F8, {}, {}, {}); } catch(e) {}
Bun.gc(true);
console.log("OK");
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("runtime error");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
