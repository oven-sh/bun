/**
 * scripts/darwin-ci/lib/tart.ts start() sends stdout and stderr of `tart run` to one log file. The command hook
 * (scripts/darwin-ci/hooks/command.ts) names that file when a guest does not boot, and it retries a failed boot with
 * a second `tart run` on the same file.
 *
 * tart runs on macOS only. Here the tart binary is the bun under test and the "vm" is a script, so the
 * `tart run <vm> --no-graphics` that start() spawns is `bun run <script> --no-graphics`.
 */
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, tempDir } from "harness";
import { join } from "node:path";

// a stand-in for `tart run`: it writes each line to the given descriptor, in this order
const standIn = (...writes: [fd: 1 | 2, line: string][]) =>
  `const { writeSync } = require("node:fs");\n` +
  writes.map(([fd, line]) => `writeSync(${fd}, ${JSON.stringify(line + "\n")});\n`).join("");

// Calls tart.start once per entry, in a process of its own with bunEnv. `tart run` gets the environment of the process
// that calls start(), and a debug build that finds a BUN_DEBUG_<scope> variable there logs to stderr, which is the log.
async function startEach(bin: string, log: string, starts: [vm: string, flags?: "a" | "w"][]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "darwin-ci-tart-log-fixture.ts"), JSON.stringify({ bin, log, starts })],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { starts: stdout && JSON.parse(stdout), stderr, exitCode };
}

// scripts/darwin-ci runs on macOS hosts. Linux takes the same POSIX spawn path and can list its descriptors too.
const canRun = isMacOS || isLinux;

test.concurrent.skipIf(!canRun)("tart.start keeps stdout and stderr of every `tart run` on one log", async () => {
  using dir = tempDir("darwin-ci-tart-log", {
    "boot.js": standIn([1, "boot: status one"], [2, "boot: error: the guest did not come up"], [1, "boot: status two"]),
    "retry.js": standIn([2, "retry: warning"], [1, "retry: status"]),
    "bake.js": standIn([1, "bake: status"], [2, "bake: warning"]),
  });
  const vm = (script: string) => join(String(dir), script);
  const bootLog = "boot: status one\nboot: error: the guest did not come up\nboot: status two\n";

  expect(
    await startEach(bunExe(), join(String(dir), "vm.log"), [[vm("boot.js")], [vm("retry.js")], [vm("bake.js"), "w"]]),
  ).toEqual({
    starts: [
      { keptOpen: 0, exitCode: 0, log: bootLog },
      // the command hook's retry: a second `tart run` adds to the log of the boot that failed
      { keptOpen: 0, exitCode: 0, log: bootLog + "retry: warning\nretry: status\n" },
      // lib/bake.ts reuses one path for every bake and starts it over
      { keptOpen: 0, exitCode: 0, log: "bake: status\nbake: warning\n" },
    ],
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent.skipIf(!canRun)("tart.start leaves no descriptor open when the spawn throws", async () => {
  using dir = tempDir("darwin-ci-tart-log-throw", { "vm.log": "" });
  // no tart binary is at this path, so Bun.spawn throws
  expect(await startEach(join(String(dir), "no-such-tart"), join(String(dir), "vm.log"), [["vm"]])).toEqual({
    starts: [{ keptOpen: 0, threw: "ENOENT" }],
    stderr: "",
    exitCode: 0,
  });
});
