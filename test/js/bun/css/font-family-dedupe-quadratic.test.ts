import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The font handler removes repeated family names from a `font-family` /
// `font` value when minifying. It used to do so with an ordered remove per
// duplicate, shifting the rest of the list down each time, so a value made
// of n copies of the same name took O(n^2) to minify: 40k copies (80 KB of
// CSS) kept a release build busy for several seconds, and the time
// quadrupled with every doubling of the input. Dedupe is now a single
// compaction pass.
//
// The size below is chosen so the old quadratic dedupe cannot finish before
// the spawn timeout kills the child (it needs minutes even in a release
// build) while the linear version finishes in a few seconds in a debug
// build.
test("font-family with many duplicate names minifies in linear time", async () => {
  const n = 1_000_000;
  const script = `
    const { minifyTest } = require("bun:internal-for-testing").cssInternals;
    const css = "a{font-family:" + Buffer.alloc(${n} * 2, "f,").toString() + "serif}";
    console.log(minifyTest(css, ""));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
    killSignal: "SIGKILL",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({
    stdout,
    stderr: /error|panic|assert|crash|abort/i.test(stderr) ? stderr : "",
    exitCode,
    signalCode: proc.signalCode,
  }).toEqual({
    stdout: "a{font-family:f,serif}\n",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
}, 90_000);

test("font-family dedupe keeps the first occurrence of each family in order", () => {
  expect(
    [
      `a{font-family:Foo,serif,Foo,"Bar",serif,Bar,"serif"}`,
      `a{font-family:serif,f,serif,f,sans-serif,f,serif}`,
      `a{font:12px Foo,Foo,serif}`,
    ].map(css => cssInternals.minifyTest(css, "")),
  ).toEqual([`a{font-family:Foo,serif,Bar,"serif"}`, `a{font-family:serif,f,sans-serif}`, `a{font:12px Foo,serif}`]);
});
