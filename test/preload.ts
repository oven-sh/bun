import path from "node:path";
import { statSync } from "node:fs";
import { expect } from "bun:test";
import * as harness from "./harness";

// We make Bun.env read-only
// so process.env = {} causes them to be out of sync and we assume Bun.env is
for (let key in process.env) {
  if (key === "TZ") continue;
  if (key in harness.bunEnv) continue;
  delete process.env[key];
}

for (let key in harness.bunEnv) {
  if (key === "TZ") continue;
  if (harness.bunEnv[key] === undefined) {
    continue;
  }
  process.env[key] = harness.bunEnv[key] + "";
}

if (Bun.$?.env) Bun.$.env(process.env);

const pluginDir = path.resolve(import.meta.dirname, "..", "packages", "bun-plugin-svelte");
expect(statSync(pluginDir).isDirectory()).toBeTrue();
Bun.spawnSync([harness.bunExe(), "install"], {
  cwd: pluginDir,
  stdio: ["ignore", "ignore", "ignore"],
  env: harness.bunEnv,
});
