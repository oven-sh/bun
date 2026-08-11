import { expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

test("react-tailwind template passes tsc --noEmit", async () => {
  // Read template files from source
  // `src/cli` is a committed symlink → `runtime/cli`; Windows git agents
  // (no SeCreateSymbolicLinkPrivilege / core.symlinks=false) write a
  // 12-byte text file instead of a directory link, so go to the canonical
  // path directly.
  const templateDir = join(repoRoot, "src/runtime/cli/init/react-tailwind");
  const buildTs = readFileSync(join(templateDir, "build.ts"), "utf8");
  const tsconfigJson = readFileSync(join(templateDir, "tsconfig.json"), "utf8");

  // Create temp directory with template files. The only package build.ts
  // imports is bun-plugin-tailwind, whose published type declarations amount
  // to `declare const plugin: BunPlugin; export default plugin;`.
  using dir = tempDir("issue-24364", {
    "build.ts": buildTs,
    "tsconfig.json": tsconfigJson,
    "node_modules/bun-plugin-tailwind/package.json": JSON.stringify({
      name: "bun-plugin-tailwind",
      version: "0.0.0",
      types: "./index.d.ts",
    }),
    "node_modules/bun-plugin-tailwind/index.d.ts": `import type { BunPlugin } from "bun";
declare const plugin: BunPlugin;
export default plugin;
`,
  });

  // The template's tsconfig asks for `"types": ["bun", "react"]`. Instead of
  // installing @types/bun and @types/react, resolve them from the repo:
  // packages/@types/bun is the in-tree @types/bun (it references
  // packages/bun-types), and @types/react comes from test/node_modules.
  const typeRoots = [join(repoRoot, "packages/@types"), dirname(dirname(require.resolve("@types/react/package.json")))];

  // What matters is that the template typechecks, not which runtime runs the
  // compiler, and tsc under a debug+ASAN bun is 10-50x slower (same as
  // test/cli/init/init.test.ts).
  await using tsc = Bun.spawn({
    cmd: [
      nodeExe() ?? bunExe(),
      require.resolve("typescript/lib/tsc.js"),
      "--noEmit",
      "--typeRoots",
      typeRoots.join(","),
    ],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([tsc.stdout.text(), tsc.stderr.text(), tsc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});
