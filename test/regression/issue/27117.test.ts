import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("CSS bundler should not drop :root rule before @property", async () => {
  using dir = tempDir("css-property-root-dedup", {
    "input.css": `:root {
  --bar: 1;
}

@property --foo {
  syntax: "<number>";
  inherits: true;
  initial-value: 0;
}

:root {
  --baz: 2;
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "input.css", "--outdir", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = await Bun.file(`${dir}/out/input.css`).text();

  // Both :root blocks must be preserved — they cannot be merged across the @property boundary
  expect(output).toContain("--bar: 1");
  expect(output).toContain("--baz: 2");
  expect(output).toContain("@property --foo");
  expect(exitCode).toBe(0);
});
