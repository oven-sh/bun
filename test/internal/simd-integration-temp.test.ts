import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// Temporary: prints a table.
test.skipIf(!process.env.BUN_SIMD_BENCHMARK)(
  "Brotli against main",
  async () => {
    const [, step] = /--step=(\S+)/.exec(process.env.BUILDKITE_COMMAND!)!;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        join(import.meta.dir, "../../scripts/compare-times.ts"),
        step,
        "01a1ed83-d1d9-4061-a559-627cb1028f19",
      ],
      env: { ...process.env, ...bunEnv },
      stdio: ["ignore", "inherit", "inherit"],
    });
    expect(await proc.exited).toBe(0);
  },
  290_000,
);
