// The hook blocks the event loop, so the timer of its own timeout cannot fire.
// bun:test's deadline, 5 s behind that timeout, ends the process.
const { before, test } = require("node:test");
const { spawnSync } = require("node:child_process");

before(
  () => {
    const { signal } = spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], { stdio: "ignore" });
    console.log(`child: ${signal}`);
  },
  { timeout: 50 },
);

test("a test", () => {});
