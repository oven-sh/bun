import { test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { variant } from "./run-programs";

using probe = tempDir("trimmed-runtime-probe", { "hello.ts": "console.log(1);" });
const probed = Bun.spawnSync({
  cmd: [bunExe(), "build", "--compile", "--compile-trim-runtime", "hello.ts", "--outfile", "hello"],
  cwd: String(probe),
  env: bunEnv,
  stderr: "pipe",
});

if (probed.exitCode === 0) variant("trimmed-runtime", { BUN_FEATURE_FLAG_TRIM_RUNTIME: "1" }, {}, 2, 3);
else test.skip("this Bun was linked without islands", () => {});
