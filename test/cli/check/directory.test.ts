// `bun check <directory>` where no tsconfig.json at or above the directory has files in it: the directory stands for
// the files that the projects below it list, however `files`, `include` or `references` name them.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// Disable AI agent and CI detection regardless of the environment the tests run in.
const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  GITHUB_WORKSPACE: undefined,
  // Of the script that runs the tests.
  npm_lifecycle_event: undefined,
  npm_package_json: undefined,
  NO_COLOR: "1",
};

async function run(cwd: { toString(): string }, cmd: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...cmd], cwd: String(cwd), env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.replaceAll("\\", "/").trim(), stderr: stderr.replaceAll("\\", "/").trim(), exitCode };
}

// Instead of the library files, which a debug build takes seconds to read.
const globals = "Array<T> Boolean CallableFunction Function IArguments NewableFunction Number Object RegExp String"
  .split(" ")
  .map(name => `interface ${name} {}\n`)
  .join("");
const config = (more: object = {}, options: object = {}) =>
  JSON.stringify({ compilerOptions: { strict: true, noLib: true, types: [], ...options }, ...more });
const right = `export const right: string = "1";\n`;
const wrong = `export const wrong: string = 1;\n`;
const error = (file: string, line = 1) =>
  `apps/site/${file}(${line},14): error TS2322: Type 'number' is not assignable to type 'string'.`;
// What `create vite` writes: the nearest tsconfig.json has no files and no options of its own.
const solution = JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] });
const javascript = {
  "tsconfig.app.json": config({ include: ["src", ".types/*"] }, { allowJs: true, checkJs: true, noEmit: true }),
  ".types/globals.d.ts": globals,
  "src/legacy.js": `/** @type {string} */\nexport const wrong = 1;\n`,
};

// The files of `apps/site`, and what is reported of them from the root, which has no tsconfig.json.
const layouts: Record<string, [files: Record<string, string>, reported: string[]]> = {
  // The `include` of a Next.js app.
  "a dot directory that `include` names": [
    {
      "tsconfig.json": config({ include: ["**/*.ts", ".next/types/**/*.ts"], exclude: ["node_modules"] }),
      "globals.d.ts": globals,
      "app/page.ts": right,
      ".next/types/routes.ts": wrong,
    },
    [error(".next/types/routes.ts")],
  ],
  "a dot file in `files`": [
    {
      "tsconfig.json": config({ files: [".config.ts"], include: ["src"] }),
      "src/globals.d.ts": globals,
      ".config.ts": wrong,
    },
    [error(".config.ts")],
  ],
  "a package folder that `include` names": [
    {
      "tsconfig.json": config({ include: ["src", "node_modules/generated/*.ts"] }),
      "src/globals.d.ts": globals,
      "node_modules/generated/client.ts": wrong,
    },
    [error("node_modules/generated/client.ts")],
  ],
  "a file in `files` that `exclude` names": [
    {
      "tsconfig.json": config({ files: ["generated/client.ts"], include: ["src"], exclude: ["generated"] }),
      "src/globals.d.ts": globals,
      "generated/client.ts": wrong,
    },
    [error("generated/client.ts")],
  ],
  "JavaScript of a project that a solution references": [
    { "tsconfig.json": solution, ...javascript, "src/main.ts": wrong },
    [error("src/legacy.js", 2), error("src/main.ts")],
  ],
  // It is of the project that lists it, as in a run in `apps/site`.
  "a file beside a tsconfig.json in a dot directory, which has no say": [
    {
      "tsconfig.json": config({ include: ["src", ".storybook/**/*"] }),
      "src/globals.d.ts": globals,
      ".storybook/tsconfig.json": config({}, { strict: false }),
      ".storybook/main.ts": `${wrong}export function f(x) {\n  return x;\n}\n`,
    },
    [
      error(".storybook/main.ts"),
      `apps/site/.storybook/main.ts(2,19): error TS7006: Parameter 'x' implicitly has an 'any' type.`,
    ],
  ],
  "where the project lists a file, only what it lists": [
    {
      "tsconfig.json": config({ include: [".gen/**/*"] }),
      ".gen/globals.d.ts": globals,
      ".gen/a.ts": wrong,
      "scripts/s.ts": wrong,
    },
    [error(".gen/a.ts")],
  ],
  "where a tsconfig.json below has all that the project lists, what it does not exclude": [
    {
      "tsconfig.json": config({ include: ["sub"] }),
      "sub/tsconfig.json": config(),
      "sub/globals.d.ts": globals,
      "sub/x.ts": wrong,
      "scripts/s.ts": wrong,
    },
    [error("scripts/s.ts"), error("sub/x.ts")],
  ],
  "a file that two projects list is checked once": [
    {
      "tsconfig.json": config(),
      "globals.d.ts": globals,
      "a.ts": wrong,
      "sub/tsconfig.json": config(),
      "sub/globals.d.ts": globals,
      "sub/x.ts": wrong,
    },
    [error("a.ts"), error("sub/x.ts")],
  ],
};

// One at a time: a debug build takes half a second to start, and a dozen at once come close to the timeout.
describe("a directory without a tsconfig.json at or above it", () => {
  test.each(Object.entries(layouts))("%s", async (_, [files, reported]) => {
    using dir = tempDir("bun-check-directory", { "apps/site": files });
    const { stdout, exitCode } = await run(dir, ["check", "."]);
    expect({ reported: stdout.split("\n"), exitCode }).toEqual({ reported, exitCode: 1 });
  });

  // Not the working directory, so what is beside `apps` has no part in it.
  test.each(["a dot directory that `include` names", "JavaScript of a project that a solution references"])(
    "the directory above the package, by its name: %s",
    async name => {
      const [files, reported] = layouts[name];
      using dir = tempDir("bun-check-directory", { "apps/site": files, "loose.ts": wrong });
      const { stdout, exitCode } = await run(dir, ["check", "apps"]);
      expect({ reported: stdout.split("\n"), exitCode }).toEqual({ reported, exitCode: 1 });
    },
  );

  test("JavaScript of a project that a solution references, with no TypeScript file beside it", async () => {
    using dir = tempDir("bun-check-directory", { "apps/site": { "tsconfig.json": solution, ...javascript } });
    const { stdout, exitCode } = await run(dir, ["check", "."]);
    expect({ stdout, exitCode }).toEqual({ stdout: error("src/legacy.js", 2), exitCode: 1 });
  });

  // The tsconfig.json of `apps/admin` comes first, and what it references is not looked in twice.
  test("JavaScript of a project that the tsconfig.json of another package references too", async () => {
    const composite = { allowJs: true, checkJs: true, composite: true, emitDeclarationOnly: true, outDir: "dist" };
    using dir = tempDir("bun-check-directory", {
      "apps/admin": {
        "tsconfig.json": config({ include: ["src"], references: [{ path: "../site/tsconfig.app.json" }] }),
        "src/globals.d.ts": globals,
        "src/a.ts": right,
      },
      "apps/site": {
        ...javascript,
        "tsconfig.json": solution,
        "tsconfig.app.json": config({ include: ["src", ".types/*"] }, composite),
      },
    });
    const { stdout, exitCode } = await run(dir, ["check", "."]);
    expect({ stdout, exitCode }).toEqual({ stdout: error("src/legacy.js", 2), exitCode: 1 });
  });

  // In `node_modules` no tsconfig.json is nearest to `..`, so the one nearest to the working directory is, and it is
  // also below `..`. The tsconfig.json at the root has no files there.
  test("the tsconfig.json nearest to the working directory has its say once", async () => {
    using dir = tempDir("bun-check-directory", {
      "tsconfig.json": config({ include: ["src"] }),
      "src/globals.d.ts": globals,
      "node_modules/pkg/sub": {
        "tsconfig.json": config({ include: ["lib"] }),
        "lib/globals.d.ts": globals,
        "lib/a.ts": wrong,
        "scripts/s.ts": wrong,
      },
    });
    const { stdout, exitCode } = await run(join(String(dir), "node_modules", "pkg", "sub"), ["check", ".."]);
    expect({ stdout, exitCode }).toEqual({
      stdout: `lib/a.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.`,
      exitCode: 1,
    });
  });

  test.each([
    [wrong, 1],
    [right, 0],
  ])("`bun run --check` runs the script if a file in a dot directory has no error: %j", async (source, code) => {
    using dir = tempDir("bun-check-directory", {
      "package.json": JSON.stringify({ scripts: { build: "echo the script ran" } }),
      "apps/site": { ...layouts["a dot directory that `include` names"][0], ".next/types/routes.ts": source },
    });
    const { stdout, stderr, exitCode } = await run(dir, ["run", "--check", "build"]);
    expect({
      reports: stderr.includes(error(".next/types/routes.ts")),
      ran: stdout.includes("the script ran"),
      exitCode,
    }).toEqual({ reports: code === 1, ran: code === 0, exitCode: code });
  });
});
