import { test, expect } from "bun:test";
import { $ } from "bun";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync } from "fs";

test("cp ebusy doesn't crash", async () => {
  const dir = join(tmpdir(), "bun-test-ebusy-" + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });

  const dummyExe = join(dir, "dummy-process.exe");

  // 1. Create a dummy executable we can run
  await $`cp ${process.execPath} ${dummyExe}`;

  // 2. Run it so Windows locks the executable file
  const proc = Bun.spawn([dummyExe, "-e", "setTimeout(() => {}, 10000)"]);
  await Bun.sleep(500); // Give it time to start and lock

  // 3. Try to copy over the running executable
  try {
    await $`cp ${process.execPath} ${dummyExe}`;
  } catch (e) {
    // It failed as expected (EBUSY)
    expect(e.message.includes("exit code")).toBeTrue();
  }

  proc.kill();
  await proc.exited;

  await $`rm -rf ${dir}`.nothrow();
});
