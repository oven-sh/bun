import { spawnSync } from "bun";
import { getCounters } from "bun:internal-for-testing";

const before = getCounters();
const result = spawnSync({
  cmd: ["sleep", "0.00001"],
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});
const after = getCounters();

if (!(after.spawnSync_blocking > before.spawnSync_blocking)) {
  throw new Error("spawnSync_blocking should have been incremented");
}
