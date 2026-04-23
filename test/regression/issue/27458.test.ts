import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("CSS bundler maps logical border-radius properties to correct physical properties", async () => {
  using dir = tempDir("css-logical-border-radius", {
    "input.css": `.box {
  border-start-start-radius: var(--r, 20px);
  border-start-end-radius: var(--r, 20px);
  border-end-start-radius: var(--r, 20px);
  border-end-end-radius: var(--r, 20px);
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "input.css", "--target=browser", "--outdir", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = await Bun.file(`${dir}/out/input.css`).text();

  // Each logical property must map to its own distinct physical property.
  // The output contains LTR and RTL variants (with :lang() selectors), so
  // each physical property appears multiple times. The key check is that all
  // four distinct physical properties are present (not all mapped to one).
  expect(output).toContain("border-top-left-radius:");
  expect(output).toContain("border-top-right-radius:");
  expect(output).toContain("border-bottom-left-radius:");
  expect(output).toContain("border-bottom-right-radius:");

  // In the LTR block, verify each physical property appears exactly once.
  // Extract the first rule block (LTR) to check the mapping is correct.
  const firstBlock = output.split("}")[0];
  expect((firstBlock.match(/border-top-left-radius/g) || []).length).toBe(1);
  expect((firstBlock.match(/border-top-right-radius/g) || []).length).toBe(1);
  expect((firstBlock.match(/border-bottom-right-radius/g) || []).length).toBe(1);
  expect((firstBlock.match(/border-bottom-left-radius/g) || []).length).toBe(1);

  expect(exitCode).toBe(0);
});
