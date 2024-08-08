import { spawn } from "bun";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// prior, this would hang on Windows if you ran this with a pipe

const run = spawn({
  cmd: [bunExe(), "--watch", join(import.meta.dirname, "empty.js")],
  stdout: "inherit",
  stderr: "inherit",
  stdin: "ignore",
  env: bunEnv,
});
await Bun.sleep(250);
run.kill(9);
await run.exited;
