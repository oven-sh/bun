import { spawnSync } from "bun";
import { getCounters } from "bun:internal-for-testing";

const before = getCounters();
const result = spawnSync({
  cmd: [process.execPath, "-e", "process.exitCode = 3"],
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});
const after = getCounters();

if (!(after.spawnSync_blocking > before.spawnSync_blocking)) {
  throw new Error("spawnSync_blocking should have been incremented");
}

if (result.exitCode !== 3 || !(result.resourceUsage.maxRSS > 0)) {
  throw new Error(`exit code ${result.exitCode}, maxRSS ${result.resourceUsage.maxRSS}`);
}
