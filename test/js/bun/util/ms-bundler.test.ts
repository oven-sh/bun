import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { readFileSync } from "fs";
import { join } from "path";

// Test that Bun.ms bundler output is correct
// TODO: In the future, string literals like Bun.ms("2d") should be inlined to numbers at compile time
test("Bun.ms bundler output", async () => {
  const dir = tempDirWithFiles("ms-bundler", {
    "entry.ts": `
export const values = {
  oneSecond: Bun.ms("1s"),
  oneMinute: Bun.ms("1m"),
  oneHour: Bun.ms("1h"),
  oneDay: Bun.ms("1d"),
  twoWeeks: Bun.ms("2w"),
  halfYear: Bun.ms("0.5y"),
  withSpaces: Bun.ms("5 minutes"),
  negative: Bun.ms("-10s"),
  decimal: Bun.ms("1.5h"),
  justNumber: Bun.ms("100"),
  caseInsensitive: Bun.ms("2D"),
  formatShort: Bun.ms(1000),
  formatLong: Bun.ms(60000, { long: true }),
};
    `,
  });

  // Bundle the code
  const proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.ts", "--outfile", "out.js"],
    cwd: dir,
    env: bunEnv,
    stderr: "inherit",
    stdout: "inherit",
  });

  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);

  // Read and snapshot the bundled output
  const bundled = readFileSync(join(dir, "out.js"), "utf-8");
  expect(bundled).toMatchSnapshot();
});
