// The printer of warnings reckons the name of the program itself. An executable asked the path.basename that the program had replaced.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { unsupported } from "./harness/compiler";

test.skipIf(!!unsupported)("the first warning of an executable asks no replaced path.basename", async () => {
  using dir = tempDir("first-warning-replaced-basename", {
    "main.cjs": `
      const path = require("node:path");
      const original = path.basename;
      let calls = 0;
      path.basename = function (...args) {
        calls++;
        return original.apply(this, args);
      };
      process.emitWarning("made up");
      setImmediate(() => console.log(calls));`,
  });
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "./main.cjs", "--outfile", "main"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, buildErrors, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect({ buildErrors, buildExitCode }).toEqual({ buildErrors: expect.any(String), buildExitCode: 0 });
  await using proc = Bun.spawn({ cmd: [join(String(dir), "main")], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("0\n");
  expect(exitCode).toBe(0);
});
