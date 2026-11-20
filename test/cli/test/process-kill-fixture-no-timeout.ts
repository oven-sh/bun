import { afterAll, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The timer of this test stays armed after the test ends. It fires while the
// hook below runs. `fired` resolves after that.
let child: Bun.Subprocess;
let fired: Promise<void>;
test("arms the runner timer", () => {
  child = Bun.spawn({
    cmd: [bunExe(), "--eval", "setInterval(() => {}, 1000)"],
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
    env: bunEnv,
  });
  fired = Bun.sleep(150);
}, 100);

afterAll(async () => {
  await fired;
  child.kill("SIGKILL");
  await child.exited;
  console.log(`child: ${child.signalCode}`);
}, 0);
