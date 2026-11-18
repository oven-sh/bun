import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// Temporary: prints a table.
test.skipIf(!process.env.BUN_SIMD_COMPARE)(
  "Against main",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        join(import.meta.dir, "../../scripts/compare-times.ts"),
        "parent",
        ...JSON.parse(process.env.BUN_SIMD_COMPARE!),
      ],
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
    });
    expect(await proc.exited).toBe(0);
  },
  290_000,
);
