import { test } from "bun:test";
import { bunEnv, bunExe, isWindows, tls } from "harness";
import { join } from "node:path";

test.skipIf(!isWindows)(
  "stress.js",
  async () => {
    await Bun.spawn([bunExe(), join(import.meta.dir, "stress.js"), "--seconds", "8"], {
      env: { ...bunEnv, STRESS_TLS: JSON.stringify(tls) },
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 280_000,
    }).exited;
  },
  290_000,
);
