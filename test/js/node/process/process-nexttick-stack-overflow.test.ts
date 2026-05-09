import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// When the stack is nearly exhausted, lazily initializing process.nextTick
// runs JS that can throw a stack overflow. The lazy property callback must
// not leave an exception pending (assertion in JSObject::get) or reify the
// property as an internal Exception object.
test("process.nextTick lazy init does not leak Exception object on stack overflow", async () => {
  const src = `
    const { writeFileSync } = require("fs");
    let done = false;
    function recurse() {
      try { recurse(); } catch {}
      if (done) return;
      done = true;
      try { process.nextTick(() => {}); } catch {}
    }
    recurse();
    writeFileSync(1, "typeof=" + typeof process.nextTick + "\\n");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).not.toBe("typeof=object");
  expect(["typeof=function", "typeof=undefined"]).toContain(stdout.trim());
  expect(proc.signalCode).toBeNull();
});
