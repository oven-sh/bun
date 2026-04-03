import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test: setting `globalThis.Loader` to a non-object before the
// ESM registry map is lazily initialized used to crash in
// ZigGlobalObject.cpp because `loaderValue.getObject()` returned nullptr
// and was dereferenced unconditionally.
test("setting globalThis.Loader to a non-object does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        delete globalThis.Loader;
        globalThis.Loader = 3n;
        try { require("/proc/self/status"); } catch (e) {}
        try { await import("data:text/javascript,export default 1"); } catch (e) {}
        console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toContain("ok");
  expect(exitCode).toBe(0);
});
