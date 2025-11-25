import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bundling with file imported by another entrypoint should not crash", async () => {
  using dir = tempDir("bundler-20278", {
    "style.css": `select {
  background-image: url("./chevron-down.svg");
}
`,
    "chevron-down.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down-icon lucide-chevron-down"><path d="m6 9 6 6 6-6"/></svg>
`,
    "out/.gitkeep": "",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "style.css", "chevron-down.svg", "--outdir=out"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("Segmentation fault");
  expect(exitCode).toBe(0);
});
