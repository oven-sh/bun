import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.concurrent("Bun.build auto-installs dependencies without package.json", { timeout: 30_000 }, async () => {
  using dir = tempDir("issue-28527", {
    "entry.ts": `import isOdd from "is-odd"; console.log(isOdd(3));`,
    "build.ts": `
const result = await Bun.build({
  entrypoints: ["./entry.ts"],
  outdir: "./out",
});
if (!result.success) {
  for (const msg of result.logs) console.error(msg);
  process.exit(1);
}
console.log("BUILD_OK");
`,
  });

  const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: `${String(dir)}/cache` };

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.ts"],
    env,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("BUILD_OK");
  expect(exitCode).toBe(0);
});

test.concurrent("bun build CLI auto-installs dependencies without package.json", { timeout: 30_000 }, async () => {
  using dir = tempDir("issue-28527-cli", {
    "entry.ts": `import isOdd from "is-odd"; console.log(isOdd(3));`,
  });

  const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: `${String(dir)}/cache` };

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.ts", "--outdir", "./out"],
    env,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Could not resolve");
  expect(exitCode).toBe(0);
});
