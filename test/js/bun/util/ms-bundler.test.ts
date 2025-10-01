import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// Test that Bun.ms works in bundled output
// TODO: Implement compile-time inlining so Bun.ms("2d") becomes 172800000
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

  const result = await Bun.build({
    entrypoints: [join(dir, "entry.ts")],
  });

  expect(result.success).toBe(true);
  expect(result.outputs).toHaveLength(1);

  const output = await result.outputs[0].text();
  expect(output).toMatchInlineSnapshot(`
    "// ../../tmp/ms-bundler_2IefkN/entry.ts
    var values = {
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
      formatLong: Bun.ms(60000, { long: true })
    };
    export {
      values
    };
    "
  `);
});
