import { spawnSync } from "bun";
import { getCounters } from "bun:internal-for-testing";

const isWindows = process.platform === "win32";

const before = getCounters();
const result = spawnSync({
  cmd: isWindows ? ["cmd", "/c", "exit 0"] : ["sleep", "0.00001"],
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});
const after = getCounters();

if (!(after.spawnSync_blocking > before.spawnSync_blocking)) {
  throw new Error("spawnSync_blocking should have been incremented");
}
if (result.exitCode !== 0 || !result.success) {
  throw new Error("expected exit code 0, got " + result.exitCode);
}

// The blocking wait reports how the child ended.
const failed = spawnSync({
  cmd: isWindows ? ["cmd", "/c", "exit 7"] : ["sh", "-c", "exit 7"],
  stdout: "ignore",
  stderr: "ignore",
  stdin: "ignore",
});
if (!(getCounters().spawnSync_blocking > after.spawnSync_blocking)) {
  throw new Error("spawnSync_blocking should have been incremented again");
}
if (failed.exitCode !== 7 || failed.success || failed.signalCode !== undefined) {
  throw new Error("expected exit code 7, got " + JSON.stringify(failed));
}

// A pipe to drain or a timeout to keep needs the event loop.
const piped = spawnSync({
  cmd: isWindows ? ["cmd", "/c", "echo hi"] : ["echo", "hi"],
  stdout: "pipe",
  stderr: "inherit",
  stdin: "ignore",
});
const timed = spawnSync({
  cmd: isWindows ? ["cmd", "/c", "exit 0"] : ["true"],
  stdout: "ignore",
  stderr: "ignore",
  stdin: "ignore",
  timeout: 60_000,
});
if (getCounters().spawnSync_blocking !== after.spawnSync_blocking + 1) {
  throw new Error("spawnSync with a pipe or a timeout must not block the thread");
}
if (piped.stdout.toString().trim() !== "hi" || piped.exitCode !== 0 || timed.exitCode !== 0) {
  throw new Error("unexpected result: " + JSON.stringify({ piped: piped.stdout.toString(), timed: timed.exitCode }));
}
