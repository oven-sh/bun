// node-test.test.ts runs this with `--timeout 300`: the runner's timer for the
// test stays armed after the test ends and fires while the after() hook runs.
// It must not kill the process. `fired` resolves after that timer.
const { after, test } = require("node:test");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

let child;
let fired;
test("arms the runner timer", () => {
  child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  fired = new Promise(resolve => setTimeout(resolve, 350));
});

after(
  async () => {
    const exited = once(child, "exit");
    await fired;
    child.kill("SIGKILL");
    const [, signal] = await exited;
    console.log(`child: ${signal}`);
  },
  { timeout: Infinity },
);
