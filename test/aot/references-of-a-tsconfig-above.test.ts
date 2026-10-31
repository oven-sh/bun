import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const options = {
  target: "ESNext",
  module: "Preserve",
  moduleResolution: "bundler",
  typeRoots: [join(import.meta.dir, "..", "..", "packages")],
  types: ["bun-types"],
  strict: true,
  composite: true,
  outDir: "lib",
  rootDir: "src",
};
const config = JSON.stringify({ compilerOptions: options, include: ["src"] });

async function run(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd);
  return { said: stdout + stderr, exitCode };
}

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
const errors = (said: string) =>
  [...said.matchAll(/^error: (TS\d+):.*\n\s+at (\S+):(\d+):\d+$/gm)]
    .map(match => `${match[2].replaceAll("\\", "/").replace(/^.*\/(?=packages\/)/, "")}:${match[3]} ${match[1]}`)
    .sort();

function workspace(root: object) {
  const dir = tempDir("references-of-a-tsconfig-above", {
    "package.json": JSON.stringify({ name: "workspace", workspaces: ["packages/*"] }),
    "tsconfig.json": JSON.stringify(root),
    "packages/types/package.json": JSON.stringify({
      name: "@workspace/types",
      version: "1.0.0",
      main: "lib/index.js",
      types: "lib/index.d.ts",
    }),
    "packages/types/tsconfig.json": config,
    "packages/types/src/index.ts": `export interface Rule {\n  level: number;\n}\n`,
    "packages/types/src/types.test.ts": `import { expect, test } from "bun:test";\nimport type { Rule } from "./index";\nconst rule: Rule = { level: 2 };\ntest("its own", () => {\n  expect(rule.level).toBe(2);\n});\n`,
    "packages/app/package.json": JSON.stringify({ name: "@workspace/app", version: "1.0.0" }),
    "packages/app/tsconfig.json": config,
    "packages/app/src/app.test.ts": `import { expect, test } from "bun:test";\nimport type { Rule } from "@workspace/types";\nconst rule: Rule = { level: 1 };\ntest("a rule", () => {\n  expect(rule.level).toBe(1);\n});\n`,
  });
  mkdirSync(join(String(dir), "node_modules", "@workspace"), { recursive: true });
  symlinkSync(join(String(dir), "packages", "types"), join(String(dir), "node_modules", "@workspace", "types"), "dir");
  return dir;
}

// TODO: --aot reads the nearest tsconfig.json above a file and does not follow the `references` of one further up, so the import of the package that is not built is TS2307.
test.todo(
  "the projects that a tsconfig.json above a test file references are known to it alone as beside a test file of another package",
  async () => {
    using dir = workspace({ files: [], references: [{ path: "packages/types" }, { path: "packages/app" }] });
    const together = await run(String(dir), "test", "--aot");
    expect(errors(together.said)).toEqual([]);
    expect(passed(together.said)).toEqual(["a rule", "its own"]);
    const alone = await run(String(dir), "test", "--aot", "./packages/app/src/app.test.ts");
    expect(errors(alone.said)).toEqual([]);
    expect(passed(alone.said)).toEqual(["a rule"]);
    const inside = await run(join(String(dir), "packages", "app"), "test", "--aot");
    expect(errors(inside.said)).toEqual([]);
    expect(passed(inside.said)).toEqual(["a rule"]);
  },
  60_000,
);

test("a package that no tsconfig.json references and that is not built is not found", async () => {
  using dir = workspace({ files: [], references: [{ path: "packages/app" }] });
  const { said, exitCode } = await run(String(dir), "test", "--aot", "./packages/app/src/app.test.ts");
  expect(errors(said)).toEqual(["packages/app/src/app.test.ts:2 TS2307"]);
  expect(exitCode).toBe(1);
}, 60_000);
