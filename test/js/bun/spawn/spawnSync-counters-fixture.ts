import { spawnSync } from "bun";
import { getCounters } from "bun:internal-for-testing";
import { spawnSync as nodeSpawnSync } from "node:child_process";

const spawns = {
  "Bun.spawnSync": () =>
    spawnSync({
      cmd: ["sleep", "0.00001"],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    }),
  "child_process.spawnSync": () => nodeSpawnSync("sleep", ["0.00001"], { stdio: "inherit" }),
};

for (const [name, spawn] of Object.entries(spawns)) {
  const before = getCounters();
  spawn();
  const after = getCounters();

  if (!(after.spawnSync_blocking > before.spawnSync_blocking)) {
    throw new Error(`spawnSync_blocking should have been incremented by ${name}`);
  }
}
