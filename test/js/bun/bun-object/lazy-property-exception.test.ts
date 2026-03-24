import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("lazy property callback exception does not store empty JSValue", async () => {
  // When a lazy PropertyCallback on the Bun object throws (e.g. due to
  // deleted Loader), the empty JSValue returned must not be stored via
  // putDirect. An empty value (encoded 0) passes isCell() but has a null
  // cell pointer, crashing on any subsequent isGetterSetter() check
  // (e.g. during JSON.stringify or property enumeration).
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        delete globalThis.Loader;
        try { Object.getOwnPropertyNames(Bun).forEach(k => { try { Bun[k]; } catch(e) {} }); } catch(e) {}
        try { JSON.stringify(Bun); } catch(e) {}
        console.log("OK");
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

  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
