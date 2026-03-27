import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

// https://github.com/oven-sh/bun/issues/28609
// Playwright appends ".esm.preflight" to file URLs for ESM preflight checks
// via Node.js ESM loader hooks. Bun should strip this suffix and resolve
// the underlying file.

test("dynamic import with .esm.preflight suffix resolves to base file", async () => {
  using dir = tempDir("esm-preflight", {
    "package.json": JSON.stringify({ type: "module" }),
    "config.ts": `export default { value: 42 };`,
    "main.mjs": `
      import { pathToFileURL } from 'url';
      const configPath = process.argv[2];
      const fileName = pathToFileURL(configPath);
      // Playwright does this in transform.js requireOrImport():
      //   await eval(\\\`import(\\\${JSON.stringify(fileName + ".esm.preflight")})\\\`)
      await eval(\`import(\${JSON.stringify(fileName + ".esm.preflight")})\`);
      const mod = await eval(\`import(\${JSON.stringify(fileName)})\`);
      console.log(JSON.stringify(mod.default));
    `,
  });

  const configPath = path.join(String(dir), "config.ts");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs", configPath],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Cannot find module");
  expect(stdout).toBe('{"value":42}\n');
  expect(exitCode).toBe(0);
});
