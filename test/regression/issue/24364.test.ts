import { expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const bunTypes = join(repoRoot, "packages/bun-types/index.d.ts").replaceAll("\\", "/");

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
  // The published @types/bun is one line, `/// <reference types="bun-types" />`.
  // The one here names the bun-types of this checkout.
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
    "node_modules/@types/bun/index.d.ts": `/// <reference path="${bunTypes}" />\n`,
  });

  // The template's tsconfig asks for `"types": ["bun", "react"]`. Nothing is
  // installed for them: `bun` is the file above, and @types/react comes from
  // test/node_modules.
  const typeRoots = [
    join(String(dir), "node_modules/@types"),
    dirname(dirname(require.resolve("@types/react/package.json"))),
  ];

  // What matters is that the template typechecks, not which runtime runs the
  // compiler: tsc takes 2 seconds under node and 160 under a debug+ASAN bun.
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
