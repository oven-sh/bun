import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/16763
// Tagged template literals with emoji (non-BMP Unicode) were being incorrectly
// escaped to \u{...} sequences by the printer when ascii_only was true. This
// corrupted the .raw property that tag functions receive, since the raw value
// would contain the literal escape characters instead of the original emoji.
test("tagged template literals preserve emoji after bundling", async () => {
  using dir = tempDir("issue-16763", {
    "index.ts": `
import { $ } from "bun";
const result = await $\`echo 👋\`.text();
console.log(result.trim());
`,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/index.ts`],
    outdir: `${dir}/dist`,
    target: "bun",
  });

  expect(result.success).toBe(true);
  expect(result.outputs.length).toBe(1);

  const output = await result.outputs[0].text();
  // The bundled output must NOT contain \u{1f44b} escape sequences
  expect(output).not.toContain("\\u{1f44b}");
  // It must contain the actual emoji character
  expect(output).toContain("👋");

  // Verify the bundled output runs correctly
  await using proc = Bun.spawn({
    cmd: [bunExe(), `${dir}/dist/index.js`],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("👋");
  expect(exitCode).toBe(0);
});

test("String.raw preserves emoji after bundling", async () => {
  using dir = tempDir("issue-16763-string-raw", {
    "index.ts": `console.log(String.raw\`👋🌍\`);`,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/index.ts`],
    outdir: `${dir}/dist`,
    target: "bun",
  });

  expect(result.success).toBe(true);

  const output = await result.outputs[0].text();
  expect(output).toContain("👋🌍");

  await using proc = Bun.spawn({
    cmd: [bunExe(), `${dir}/dist/index.js`],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("👋🌍");
  expect(exitCode).toBe(0);
});

test("tagged template with emoji and interpolation preserves raw values after bundling", async () => {
  using dir = tempDir("issue-16763-interp", {
    "index.ts": 'function tag(strings) {\n  return strings.raw.join("|");\n}\nconsole.log(tag`🐰${"x"}🌍`);\n',
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/index.ts`],
    outdir: `${dir}/dist`,
    target: "bun",
  });

  expect(result.success).toBe(true);

  await using proc = Bun.spawn({
    cmd: [bunExe(), `${dir}/dist/index.js`],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("🐰|🌍");
  expect(exitCode).toBe(0);
});
