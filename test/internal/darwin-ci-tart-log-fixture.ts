// Calls tart.start from scripts/darwin-ci/lib/tart.ts for darwin-ci-tart-log.test.ts and prints what each call left.
// argv[2] is JSON: { "bin": <tart binary>, "log": <log path>, "starts": [[<vm>, <flags>?], ...] }
import { fstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { config } from "../../scripts/darwin-ci/lib/config.ts";

const plan: { bin: string; log: string; starts: [vm: string, flags?: "a" | "w"][] } = JSON.parse(process.argv[2]!);

// tart.ts reads config.tart.bin once, when it is first imported
(config.tart as { bin: string }).bin = plan.bin;
const { tart } = await import("../../scripts/darwin-ci/lib/tart.ts");

// the descriptors this process has on the log, found by device and inode
function openOnLog(): number {
  const { dev, ino } = statSync(plan.log, { bigint: true });
  let count = 0;
  for (const fd of readdirSync(process.platform === "darwin" ? "/dev/fd" : "/proc/self/fd")) {
    try {
      const stat = fstatSync(Number(fd), { bigint: true });
      if (stat.dev === dev && stat.ino === ino) count++;
    } catch (error) {
      // the descriptor of the listing itself is closed by now
      if ((error as NodeJS.ErrnoException).code !== "EBADF") throw error;
    }
  }
  return count;
}

const results: object[] = [];
for (const [vm, ...flags] of plan.starts) {
  let proc;
  try {
    proc = tart.start(vm, plan.log, ...flags);
  } catch (error) {
    results.push({ keptOpen: openOnLog(), threw: (error as NodeJS.ErrnoException).code });
    continue;
  }
  // `tart run` has its own copies of the descriptor, and start() keeps none
  const keptOpen = openOnLog();
  results.push({ keptOpen, exitCode: await proc.exited, log: readFileSync(plan.log, "utf8") });
}
console.log(JSON.stringify(results));
