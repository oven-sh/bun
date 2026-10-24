/**
 * scripts/darwin-ci/lib/tart.ts start() sends stdout and stderr of `tart run` to one log file. The command hook
 * (scripts/darwin-ci/hooks/command.ts) names that file when a guest does not boot, and it retries a failed boot with
 * a second `tart run` on the same file.
 *
 * tart runs on macOS only. Here config.tart.bin is the bun under test and the "vm" is a script, so the
 * `tart run <vm> --no-graphics` that start() spawns is `bun run <script> --no-graphics`.
 */
import { expect, test } from "bun:test";
import { bunExe, isLinux, isMacOS, tempDir } from "harness";
import { fstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../scripts/darwin-ci/lib/config.ts";

// tart.ts reads config.tart.bin once, when it is first imported, so the stand-in goes in before a dynamic import
const tartConfig = config.tart as { bin: string };
const realTart = tartConfig.bin;
tartConfig.bin = bunExe();
const { tart } = await import("../../scripts/darwin-ci/lib/tart.ts").finally(() => (tartConfig.bin = realTart));

// a stand-in for `tart run`: it writes each line to the given descriptor, in this order
const standIn = (...writes: [fd: 1 | 2, line: string][]) =>
  `const { writeSync } = require("node:fs");\n` +
  writes.map(([fd, line]) => `writeSync(${fd}, ${JSON.stringify(line + "\n")});\n`).join("");

// The descriptors this process has on the log, found by device and inode. A count of all descriptors would also
// move with the other test files that run in this process.
const openOnLog = (log: string) => {
  const { dev, ino } = statSync(log, { bigint: true });
  let count = 0;
  for (const fd of readdirSync(isMacOS ? "/dev/fd" : "/proc/self/fd")) {
    try {
      const stat = fstatSync(Number(fd), { bigint: true });
      if (stat.dev === dev && stat.ino === ino) count++;
    } catch {} // the descriptor of the listing itself, closed by now
  }
  return count;
};

// scripts/darwin-ci runs on macOS hosts. Linux takes the same POSIX spawn path and can list its descriptors too.
const canRun = isMacOS || isLinux;

test.skipIf(!canRun)("tart.start keeps stdout and stderr of every `tart run` on one log", async () => {
  using dir = tempDir("darwin-ci-tart-log", {
    "boot.js": standIn([1, "boot: status one"], [2, "boot: error: the guest did not come up"], [1, "boot: status two"]),
    "retry.js": standIn([2, "retry: warning"], [1, "retry: status"]),
    "bake.js": standIn([1, "bake: status"], [2, "bake: warning"]),
  });
  const log = join(String(dir), "vm.log");
  const run = async (script: string, flags?: "a" | "w") => {
    const proc = tart.start(join(String(dir), script), log, flags);
    // `tart run` has its own copies of the descriptor, and start() keeps none
    const keptOpen = openOnLog(log);
    return { keptOpen, exitCode: await proc.exited, log: readFileSync(log, "utf8") };
  };
  const bootLog = "boot: status one\nboot: error: the guest did not come up\nboot: status two\n";

  expect(await run("boot.js")).toEqual({ keptOpen: 0, exitCode: 0, log: bootLog });
  // the command hook's retry: a second `tart run` adds to the log of the boot that failed
  expect(await run("retry.js")).toEqual({
    keptOpen: 0,
    exitCode: 0,
    log: bootLog + "retry: warning\nretry: status\n",
  });
  // lib/bake.ts reuses one path for every bake and starts it over
  expect(await run("bake.js", "w")).toEqual({ keptOpen: 0, exitCode: 0, log: "bake: status\nbake: warning\n" });
});

test.skipIf(!canRun)("tart.start leaves no descriptor open when the spawn throws", () => {
  using dir = tempDir("darwin-ci-tart-log-throw", { "vm.log": "" });
  const log = join(String(dir), "vm.log");
  // Bun.spawn rejects a NUL byte in argv before it starts anything
  expect(() => tart.start("vm\0", log)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }));
  expect(openOnLog(log)).toBe(0);
});
