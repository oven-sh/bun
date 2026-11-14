// Temporary: repeats a file on the machines that have Metal.
import { test } from "bun:test";
import { bunEnv, bunExe, isArm64, isMacOS } from "harness";
import { hostname } from "node:os";
import { join } from "node:path";
import "./driver";

export function probeMetal() {
  test.skipIf(!(isMacOS && isArm64) && !process.env.PROBE).each([1, 2])(
    "%d",
    async () => {
      const counts: Record<string, number> = {};
      for (const end = performance.now() + Number(process.env.PROBE ?? 45_000); performance.now() < end; ) {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "test", "--timeout=30000", join(import.meta.dir, "webgpu-lifetime.test.ts")],
          env: bunEnv,
          stdout: "ignore",
          stderr: "pipe",
        });
        const lines = (await proc.stderr.text()).split("\n");
        const failures = lines.filter(line => /^(\(fail\)|✗|[-+]|Expected|Received) /.test(line));
        const key = "tests: " + (failures.map(line => line.slice(0, 150)).join(" / ") || "pass");
        counts[key] = (counts[key] ?? 0) + 1;
      }
      console.log("PROBE", hostname(), new Date().toISOString().slice(11, 19), "|", "the file", JSON.stringify(counts));
    },
    85_000,
  );
}
