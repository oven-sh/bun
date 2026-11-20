// The hook blocks the event loop, so the timer of its own timeout cannot fire.
// bun:test's deadline is the later of that timeout + 5 s and the runner default.
// node-test.test.ts runs this with three runner defaults. The child lives longer
// than 5 s, so the default deadline kills it and a later one does not.
const { before, test } = require("node:test");
const { spawnSync } = require("node:child_process");

before(
  () => {
    const { signal } = spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 5500)"], { stdio: "ignore" });
    console.log(`child: ${signal}`);
  },
  { timeout: 1 },
);

test("a test", () => {});
