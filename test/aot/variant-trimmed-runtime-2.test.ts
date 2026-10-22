import { test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { variant } from "./run-programs";

using probe = tempDir("trimmed-runtime-probe", { "hello.ts": "console.log(1);" });
const probed = Bun.spawnSync({
  cmd: [bunExe(), "build", "--compile", "--trim", "hello.ts", "--outfile", "hello"],
  cwd: String(probe),
  env: bunEnv,
  stderr: "pipe",
});

if (probed.exitCode === 0) variant("trimmed-runtime", ["--trim"], {}, 2, 3);
else test.skip("this Bun was not linked for --trim", () => {});
