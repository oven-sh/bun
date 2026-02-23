import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("CSS logical properties should not be stripped when nested rules are present", async () => {
  // Test for regression of issue #25794: CSS logical properties (e.g., inset-inline-end)
  // are stripped from bundler output when they appear in a nested selector that also
  // contains further nested rules (like pseudo-elements).

  const dir = tempDirWithFiles("css-logical-properties-nested", {
    "input.css": `.test-longform {
  background-color: teal;

  &.test-longform--end {
    inset-inline-end: 20px;

    &:after {
      content: "";
    }
  }
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "input.css", "--outdir", "out"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Verify the output CSS contains the logical property fallbacks
  const outputContent = await Bun.file(`${dir}/out/input.css`).text();

  // Helper function to normalize CSS output for snapshots
  function normalizeCSSOutput(output: string): string {
    return output
      .replace(/\/\*.*?\*\//g, "/* [path] */") // Replace comment paths
      .trim();
  }

  // The output should contain LTR/RTL fallback rules for inset-inline-end
  // inset-inline-end: 20px should generate:
  // - right: 20px for LTR languages
  // - left: 20px for RTL languages
  // The bundler generates vendor-prefixed variants for browser compatibility
  expect(normalizeCSSOutput(outputContent)).toMatchInlineSnapshot(`
    "/* [path] */
    .test-longform {
      background-color: teal;
    }

    .test-longform.test-longform--end:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
      right: 20px;
    }

    .test-longform.test-longform--end:not(:-moz-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
      right: 20px;
    }

    .test-longform.test-longform--end:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
      right: 20px;
    }

    .test-longform.test-longform--end:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
      left: 20px;
    }

    .test-longform.test-longform--end:-moz-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
      left: 20px;
    }

    .test-longform.test-longform--end:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
      left: 20px;
    }

    .test-longform.test-longform--end:after {
      content: "";
    }"
  `);

  // Should exit successfully
  expect(exitCode).toBe(0);
});
