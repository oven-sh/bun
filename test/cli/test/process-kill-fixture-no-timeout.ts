import { afterAll, beforeAll, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The timer of the test stays armed after the test ends. It fires while the
// afterAll hook runs. `fired` resolves after that. The beforeAll hook starts
// the process, so the test is fast and the process exists before the timer.
let child: Bun.Subprocess;
let fired: Promise<void>;
beforeAll(() => {
  child = Bun.spawn({
    cmd: [bunExe(), "--eval", "setInterval(() => {}, 1000)"],
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
    env: bunEnv,
  });
}, 0);

test("arms the runner timer", () => {
  fired = Bun.sleep(350);
}, 300);

afterAll(async () => {
  await fired;
  child.kill("SIGKILL");
  await child.exited;
  console.log(`child: ${child.signalCode}`);
}, 0);
