import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isMacOS, strictSystemAllocatorEnv } from "harness";
import { join } from "path";
import { groups } from "./system-library-calls-fixture";

const fixture = join(import.meta.dir, "system-library-calls-fixture.ts");
const divisor = isDebug || isASAN ? "10" : "1";
// The frameworks behind these write logs of their own to stdout and stderr.
const logsOnMacOS = ["images", "web views", "secrets"];
const complaint = /malloc|alloc|freed|corrupt|panic|crash|abort|signal|fault/i;

describe.each([
  ["the system allocator as it is", { MallocDebugReport: "crash" }],
  ["the system allocator checking itself", strictSystemAllocatorEnv],
])("with %s", (_, env) => {
  test.concurrent.each(Object.keys(groups))(
    "%s",
    async group => {
      // How far the others have got when a process exits differs from run to run.
      for (let run = group.startsWith("process.exit") ? 10 : 1; run > 0; run--) {
        await using child = Bun.spawn({
          cmd: [bunExe(), fixture, group, divisor],
          env: { ...bunEnv, ...env },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
        const hasLogs = isMacOS && logsOnMacOS.includes(group);
        const relevant = hasLogs
          ? stderr
              .split("\n")
              .filter(line => complaint.test(line))
              .join("\n")
          : stderr;
        expect({
          stdout: hasLogs ? stdout.slice(stdout.lastIndexOf("\n", stdout.length - 2) + 1) : stdout,
          stderr: relevant,
          exitCode,
          signalCode: child.signalCode,
        }).toEqual({
          stdout: "done\n",
          stderr: "",
          exitCode: 0,
          signalCode: null,
        });
      }
    },
    180_000,
  );
});
