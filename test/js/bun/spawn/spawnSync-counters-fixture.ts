import { spawnSync } from "bun";
import { getCounters } from "bun:internal-for-testing";
import child_process, { type StdioOptions } from "node:child_process";

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

// node:child_process passes a maxBuffer with every sync call. Only a call that reads a pipe has a use for it.
const withoutPipe: StdioOptions[] = ["inherit", "ignore", [0, 1, 2], ["ignore", "inherit", "inherit"]];
for (const stdio of withoutPipe) {
  for (const [name, call] of [
    ["spawnSync", () => child_process.spawnSync("sleep", ["0.00001"], { stdio })],
    ["execFileSync", () => child_process.execFileSync("sleep", ["0.00001"], { stdio })],
    ["execSync", () => child_process.execSync("sleep 0.00001", { stdio })],
  ] as const) {
    const { spawnSync_blocking } = getCounters();
    call();
    if (getCounters().spawnSync_blocking !== spawnSync_blocking + 1) {
      throw new Error(`child_process.${name} with stdio ${JSON.stringify(stdio)} should block the thread`);
    }
  }
}
