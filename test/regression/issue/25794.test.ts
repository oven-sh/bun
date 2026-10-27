import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const { prefixTest } = cssInternals;

const source = `.test-longform {
  background-color: teal;

  &.test-longform--end {
    inset-inline-end: 20px;

    &:after {
      content: "";
    }
  }
}
`;

test("CSS logical properties should not be stripped when nested rules are present", async () => {
  // Test for regression of issue #25794: CSS logical properties (e.g., inset-inline-end)
  // are stripped from bundler output when they appear in a nested selector that also
  // contains further nested rules (like pseudo-elements).

  await using dir = tempDir("css-logical-properties-nested", {
    "input.css": source,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "input.css", "--outdir", "out"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Verify the output CSS preserves the logical property
  const outputContent = await Bun.file(`${dir}/out/input.css`).text();

  // Helper function to normalize CSS output for snapshots
  function normalizeCSSOutput(output: string): string {
    return output
      .replace(/\/\*.*?\*\//g, "/* [path] */") // Replace comment paths
      .trim();
  }

  // The default browser targets support inset-inline-end, so it passes
  // through unchanged. The bug stripped the declaration entirely.
  expect(normalizeCSSOutput(outputContent)).toMatchInlineSnapshot(`
    "/* [path] */
    .test-longform {
      background-color: teal;
    }

    .test-longform.test-longform--end {
      inset-inline-end: 20px;
    }

    .test-longform.test-longform--end:after {
      content: \"\";
    }"
  `);

  // Should exit successfully
  expect(exitCode).toBe(0);
});

test("CSS logical properties in nested rules survive compiling for old targets", () => {
  // Safari 14 does not support inset-inline-end, so it is compiled to
  // left/right fallbacks with :lang() selectors. The bug stripped the
  // declaration when the rule also contained further nested rules.
  const output = prefixTest(source, "", { safari: 14 << 16 });

  expect(output).toContain("right: 20px");
  expect(output).toContain("left: 20px");
  expect(output).toContain("content:");
  expect(output).toContain("background-color: teal");
});
