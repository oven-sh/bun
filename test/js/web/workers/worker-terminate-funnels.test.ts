// A worker is terminated at three fixed points relative to each native→JS entry
// point (see worker-terminate-funnels-fixture.ts): while the callback is armed
// but cannot have fired, while JS is inside it, and with its follow-on
// completion in flight. Every case must end with 'exit' and nothing else. On
// debug/ASAN builds the runtime's own assertions turn "script entered after the
// stop was requested", use-after-free and leaked handles into failures here.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "node:path";

const fixture = join(import.meta.dirname, "worker-terminate-funnels-fixture.ts");

const FAMILIES: Record<string, number> = {
  timers: 16,
  messaging: 13,
  net: 17,
  http: 18,
  fs: 15,
  pool: 20,
  subprocess: 9,
  dns: 7,
  loader: 15,
  counted: 4,
};

describe.concurrent("terminate() at every native→JS entry point", () => {
  for (const [family, cases] of Object.entries(FAMILIES)) {
    test(
      family,
      async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), fixture, family],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        // stderr carries the runtime's own diagnostics on a failure; show it first.
        // On a failure stdout is "FAIL" plus one line per case ("<entry> [<phase>]: <why>").
        expect({ stdout: stdout.trim(), exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({
          stdout: `ok ${cases}`,
          exitCode: 0,
          stderr: "",
        });
        // ~150 worker lifecycles across ten host processes: a second or two in
        // release; the debug/ASAN builds get headroom for running them all at once.
      },
      isDebug || isASAN ? 30_000 : 10_000,
    );
  }
});
