import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, noCoreCmd } from "harness";

test.skipIf(!isLinux)("noCoreCmd executes its child with unchanged arguments even if procfs is read-only", () => {
  const args = ["two words", `quote'"`, "$HOME;$(false)", ""];
  const result = Bun.spawnSync({
    cmd: noCoreCmd([bunExe(), "-e", `console.log(JSON.stringify(process.argv.slice(-4)))`, "--", ...args]),
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  expect({
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
    signalCode: result.signalCode,
  }).toEqual({
    stdout: JSON.stringify(args) + "\n",
    stderr: "",
    exitCode: 0,
    signalCode: undefined,
  });
});
