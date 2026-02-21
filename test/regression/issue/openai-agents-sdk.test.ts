import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The OpenAI Agents SDK depends on @modelcontextprotocol/sdk which has a large
// module graph (80+ files including zod v4 locale files). When loading via
// static import, the concurrent transpiler could drop module fetch promises
// if too many jobs were dispatched simultaneously, causing the process to hang.
//
// This test creates a synthetic large ESM dependency graph that mimics the
// structure of zod v4 (many re-exports via export *) to reproduce the issue
// without requiring the actual packages.
test("static import of package with large ESM dependency graph does not hang", async () => {
  // Create a synthetic package with 80+ modules and deep export * chains
  const files: Record<string, string> = {
    "index.mjs": `
import { VALUE_0 } from './node_modules/large-pkg/entry.mjs';
console.log("value:" + VALUE_0);
`,
  };

  const moduleCount = 80;
  const pkgDir = "node_modules/large-pkg";

  // entry.mjs re-exports from hub.mjs which re-exports from all leaf modules
  files[`${pkgDir}/package.json`] = JSON.stringify({ name: "large-pkg", type: "module" });
  files[`${pkgDir}/entry.mjs`] = `export * from './hub.mjs';\nexport * from './extra.mjs';`;

  // hub.mjs does export * from each leaf module
  let hubContent = "";
  for (let i = 0; i < moduleCount; i++) {
    hubContent += `export * from './leaf${i}.mjs';\n`;
  }
  files[`${pkgDir}/hub.mjs`] = hubContent;

  // extra.mjs also re-exports from some leaf modules (creating diamond pattern)
  let extraContent = "";
  for (let i = 0; i < 20; i++) {
    extraContent += `export * from './leaf${i}.mjs';\n`;
  }
  files[`${pkgDir}/extra.mjs`] = extraContent;

  // Each leaf module exports a unique value and imports from a shared core
  for (let i = 0; i < moduleCount; i++) {
    files[`${pkgDir}/leaf${i}.mjs`] = `
import { CORE } from './core.mjs';
export const VALUE_${i} = CORE + ${i};
`;
  }

  // core.mjs is shared by all leaf modules
  files[`${pkgDir}/core.mjs`] = `export const CORE = 42;`;

  using dir = tempDir("large-esm-graph", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("value:42");
  expect(exitCode).toBe(0);
}, 30_000);
