import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// Test that Bun.ms string literals are inlined at compile time
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
    minify: {
      syntax: true,
    },
  });

  expect(result.success).toBe(true);
  expect(result.outputs).toHaveLength(1);

  let output = await result.outputs[0].text();
  // Normalize the temp directory path in the output
  output = output.replace(/\/\/.*?\/entry\.ts/, "// entry.ts");
  expect(output).toMatchInlineSnapshot(`
    "// entry.ts
    var values = {
      oneSecond: 1000,
      oneMinute: 60000,
      oneHour: 3600000,
      oneDay: 86400000,
      twoWeeks: 1209600000,
      halfYear: 15778800000,
      withSpaces: 300000,
      negative: -1e4,
      decimal: 5400000,
      justNumber: 100,
      caseInsensitive: 172800000,
      formatShort: Bun.ms(1000),
      formatLong: Bun.ms(60000, { long: !0 })
    };
    export {
      values
    };
    "
  `);
});
