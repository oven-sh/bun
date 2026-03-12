import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// GH-28027: StatWatcher finalize() didn't clear the Strong handle before
// deref(), causing HandleSet::deallocate() to be called from a WorkPool
// thread when deinit() ran, corrupting the HandleSet linked list.
test("StatWatcher GC after dropping _handle does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const fs = require("fs");
const path = require("path");
const os = require("os");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bun-gc-28027-"));

for (let i = 0; i < 20; i++) {
  fs.writeFileSync(path.join(dir, "f" + i + ".txt"), "data-" + i);
}

for (let i = 0; i < 20; i++) {
  const w = fs.watchFile(path.join(dir, "f" + i + ".txt"), { interval: 5 }, () => {});
  w._handle = null;
}

await Bun.sleep(100);
Bun.gc(true);
await Bun.sleep(200);
Bun.gc(true);
await Bun.sleep(100);
Bun.gc(true);

fs.rmSync(dir, { recursive: true, force: true });
console.log("OK");
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
