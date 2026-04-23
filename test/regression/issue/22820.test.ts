import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/22820
// Bun.build with env: 'disable' should not inline process.env.NODE_ENV
test("Bun.build env: 'disable' does not inline NODE_ENV", async () => {
  using dir = tempDir("issue-22820", {
    "program.ts": `
console.log(process.env.NODE_ENV);
console.log(process.env.SOMETHING_ELSE);
console.log(process.env.NODE_ENV !== "production");
console.log(process.env.SOMETHING_ELSE !== "production");
`,
    "build.ts": `
const result = await Bun.build({
  entrypoints: ['./program.ts'],
  outdir: './dist',
  target: 'bun',
  env: 'disable',
});
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
`,
  });

  // Run the build
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [buildStdout, buildStderr, buildExit] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  expect(buildStderr).toBe("");
  expect(buildExit).toBe(0);

  // Read the bundled output and verify NODE_ENV is NOT inlined
  const output = await Bun.file(`${dir}/dist/program.js`).text();
  // process.env.NODE_ENV should appear twice (not replaced with a string literal)
  expect(output.match(/process\.env\.NODE_ENV/g)?.length).toBe(2);
  expect(output).toContain("process.env.SOMETHING_ELSE");
  // "development" should NOT appear — that was the buggy inlined value
  expect(output).not.toContain('"development"');
  // The comparison should NOT be constant-folded to `true`
  expect(output).not.toMatch(/console\.log\(true\)/);
});
