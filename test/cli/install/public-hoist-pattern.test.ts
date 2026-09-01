import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { realpath } from "fs/promises";
import {
  type DirectoryTree,
  VerdaccioRegistry,
  bunEnv,
  bunExe,
  normalizeBunSnapshot,
  readdirSorted,
  tempDir,
} from "harness";
import { join, relative } from "path";

const registry = new VerdaccioRegistry();

// Every case installs from this one cache. `beforeAll` fills it with every version the cases resolve, so a case
// downloads and extracts nothing and its stderr is exactly "Saved lockfile". The env var is needed because CI exports
// BUN_INSTALL_CACHE_DIR (one per test file), which overrides the bunfig `cache` that createTestDir writes.
const cacheDir = tempDir("public-hoist-pattern-cache-", {});
const installEnv = { ...bunEnv, BUN_INSTALL_CACHE_DIR: String(cacheDir) };

beforeAll(async () => {
  await registry.start();

  // `two-range-deps@1.0.0` depends on `no-deps@^1.0.0` and `@types/is-number@>=1.0.0`. A case that pins
  // no-deps@1.0.0 or @types/is-number@1.0.0 dedupes the range onto the pin, every other case resolves 1.1.0 and
  // 2.0.0. The aliases put both versions in the cache.
  const { packageDir } = await registry.createTestDir({
    files: {
      "package.json": JSON.stringify({
        name: "warm-cache",
        dependencies: {
          "two-range-deps": "1.0.0",
          "a-dep": "1.0.1",
          "basic-1": "1.0.0",
          "no-deps": "1.0.0",
          "no-deps-1.1.0": "npm:no-deps@1.1.0",
          "@types/is-number": "1.0.0",
          "types-is-number-2.0.0": "npm:@types/is-number@2.0.0",
        },
      }),
    },
  });
  const { stdout, stderr, exitCode } = await install(packageDir);
  expect(stderr).toMatch(/^Resolving dependencies\nResolved, downloaded and extracted \[\d+\]\nSaved lockfile$/);
  expect(stdout).toEndWith("7 packages installed");
  expect(exitCode).toBe(0);
});

afterAll(() => {
  registry.stop();
  cacheDir[Symbol.dispose]();
});

async function install(cwd: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd,
    env: installEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: normalizeBunSnapshot(stdout, cwd), stderr: normalizeBunSnapshot(stderr, cwd), exitCode };
}

/**
 * The isolated linker's layout: `store` lists `node_modules/.bun` (one `<name>@<version>` folder per installed
 * package, plus `node_modules`, the linker's fallback directory that links every package). `links` maps every entry
 * of the given node_modules directories (scoped names flattened) to the store folder it resolves into. Real paths are
 * compared, not link text: on Windows the linker falls back to a junction, whose target is absolute.
 */
async function layout(packageDir: string, nodeModulesDirs = ["node_modules"]) {
  const store = join(await realpath(packageDir), "node_modules", ".bun");
  const links: Record<string, string> = {};
  for (const dir of nodeModulesDirs) {
    for (const entry of await readdirSorted(join(packageDir, dir))) {
      if (entry === ".bun") continue;
      const names = entry.startsWith("@")
        ? (await readdirSorted(join(packageDir, dir, entry))).map(name => `${entry}/${name}`)
        : [entry];
      for (const name of names) {
        const real = relative(store, await realpath(join(packageDir, dir, name))).replaceAll("\\", "/");
        const suffix = `/node_modules/${name}`;
        links[`${dir}/${name}`] = real.endsWith(suffix) ? real.slice(0, -suffix.length) : real;
      }
    }
  }
  return { store: await readdirSorted(store), links };
}

type Case = {
  name: string;
  /** `install.publicHoistPattern` in bunfig.toml */
  bunfig?: string | string[];
  /** `public-hoist-pattern` lines in .npmrc */
  npmrc?: string;
  packageJson: Record<string, unknown>;
  /** workspace members */
  files?: DirectoryTree;
  /** the node_modules directories `links` covers, the root one when absent */
  nodeModulesDirs?: string[];
  /** stdout after the `bun install <version>` header */
  stdout: string[];
  store: string[];
  links: Record<string, string>;
};

const cases: Case[] = [
  {
    name: "bunfig string",
    bunfig: "*typ*",
    packageJson: { name: "include-patterns", dependencies: { "two-range-deps": "1.0.0" } },
    stdout: ["+ two-range-deps@1.0.0", "", "3 packages installed"],
    store: ["@types+is-number@2.0.0", "no-deps@1.1.0", "node_modules", "two-range-deps@1.0.0"],
    links: {
      "node_modules/@types/is-number": "@types+is-number@2.0.0",
      "node_modules/two-range-deps": "two-range-deps@1.0.0",
    },
  },
  {
    name: "bunfig array",
    bunfig: ["*types*", "no-deps"],
    packageJson: { name: "array-patterns", dependencies: { "two-range-deps": "1.0.0", "a-dep": "1.0.1" } },
    stdout: ["+ a-dep@1.0.1 (v1.0.10 available)", "+ two-range-deps@1.0.0", "", "4 packages installed"],
    store: ["@types+is-number@2.0.0", "a-dep@1.0.1", "no-deps@1.1.0", "node_modules", "two-range-deps@1.0.0"],
    links: {
      "node_modules/@types/is-number": "@types+is-number@2.0.0",
      "node_modules/a-dep": "a-dep@1.0.1",
      "node_modules/no-deps": "no-deps@1.1.0",
      "node_modules/two-range-deps": "two-range-deps@1.0.0",
    },
  },
  {
    // direct dependencies are always linked, the transitive @types/is-number is installed but not hoisted
    name: "all exclude pattern",
    bunfig: "!*",
    packageJson: { name: "exclude-all", dependencies: { "two-range-deps": "1.0.0", "no-deps": "1.0.0" } },
    stdout: ["+ no-deps@1.0.0 (v2.0.0 available)", "+ two-range-deps@1.0.0", "", "3 packages installed"],
    store: ["@types+is-number@2.0.0", "no-deps@1.0.0", "node_modules", "two-range-deps@1.0.0"],
    links: {
      "node_modules/no-deps": "no-deps@1.0.0",
      "node_modules/two-range-deps": "two-range-deps@1.0.0",
    },
  },
  {
    name: "all include pattern",
    bunfig: "*",
    packageJson: { name: "include-all", dependencies: { "two-range-deps": "1.0.0" } },
    stdout: ["+ two-range-deps@1.0.0", "", "3 packages installed"],
    store: ["@types+is-number@2.0.0", "no-deps@1.1.0", "node_modules", "two-range-deps@1.0.0"],
    links: {
      "node_modules/@types/is-number": "@types+is-number@2.0.0",
      "node_modules/no-deps": "no-deps@1.1.0",
      "node_modules/two-range-deps": "two-range-deps@1.0.0",
    },
  },
  {
    name: "mixed include and exclude patterns",
    bunfig: ["*", "!@types*", "!no-deps"],
    packageJson: { name: "mixed-patterns", dependencies: { "two-range-deps": "1.0.0", "a-dep": "1.0.1" } },
    stdout: ["+ a-dep@1.0.1 (v1.0.10 available)", "+ two-range-deps@1.0.0", "", "4 packages installed"],
    store: ["@types+is-number@2.0.0", "a-dep@1.0.1", "no-deps@1.1.0", "node_modules", "two-range-deps@1.0.0"],
    links: {
      "node_modules/a-dep": "a-dep@1.0.1",
      "node_modules/two-range-deps": "two-range-deps@1.0.0",
    },
  },
  {
    name: "npmrc string configuration",
    npmrc: "public-hoist-pattern=*types*",
    packageJson: { name: "npmrc-string", dependencies: { "two-range-deps": "1.0.0" } },
    stdout: ["+ two-range-deps@1.0.0", "", "3 packages installed"],
    store: ["@types+is-number@2.0.0", "no-deps@1.1.0", "node_modules", "two-range-deps@1.0.0"],
    links: {
      "node_modules/@types/is-number": "@types+is-number@2.0.0",
      "node_modules/two-range-deps": "two-range-deps@1.0.0",
    },
  },
  {
    name: "npmrc array configuration",
    npmrc: "public-hoist-pattern[]=*types*\npublic-hoist-pattern[]=no-deps",
    packageJson: { name: "npmrc-array", dependencies: { "two-range-deps": "1.0.0", "a-dep": "1.0.1" } },
    stdout: ["+ a-dep@1.0.1 (v1.0.10 available)", "+ two-range-deps@1.0.0", "", "4 packages installed"],
    store: ["@types+is-number@2.0.0", "a-dep@1.0.1", "no-deps@1.1.0", "node_modules", "two-range-deps@1.0.0"],
    links: {
      "node_modules/@types/is-number": "@types+is-number@2.0.0",
      "node_modules/a-dep": "a-dep@1.0.1",
      "node_modules/no-deps": "no-deps@1.1.0",
      "node_modules/two-range-deps": "two-range-deps@1.0.0",
    },
  },
  {
    name: "npmrc mixed patterns",
    npmrc: "public-hoist-pattern[]=*\npublic-hoist-pattern[]=!@types*\npublic-hoist-pattern[]=!no-deps",
    packageJson: { name: "npmrc-mixed", dependencies: { "two-range-deps": "1.0.0", "a-dep": "1.0.1" } },
    stdout: ["+ a-dep@1.0.1 (v1.0.10 available)", "+ two-range-deps@1.0.0", "", "4 packages installed"],
    store: ["@types+is-number@2.0.0", "a-dep@1.0.1", "no-deps@1.1.0", "node_modules", "two-range-deps@1.0.0"],
    links: {
      "node_modules/a-dep": "a-dep@1.0.1",
      "node_modules/two-range-deps": "two-range-deps@1.0.0",
    },
  },
  {
    // two-range-deps is excluded from hoisting but stays linked because it is a direct dependency
    name: "exclude specific packages",
    bunfig: ["*", "!two-range-deps"],
    packageJson: { name: "exclude-specific", dependencies: { "two-range-deps": "1.0.0", "no-deps": "1.0.0" } },
    stdout: ["+ no-deps@1.0.0 (v2.0.0 available)", "+ two-range-deps@1.0.0", "", "3 packages installed"],
    store: ["@types+is-number@2.0.0", "no-deps@1.0.0", "node_modules", "two-range-deps@1.0.0"],
    links: {
      "node_modules/@types/is-number": "@types+is-number@2.0.0",
      "node_modules/no-deps": "no-deps@1.0.0",
      "node_modules/two-range-deps": "two-range-deps@1.0.0",
    },
  },
  {
    name: "scoped package patterns",
    bunfig: "@types/*",
    packageJson: { name: "scoped-patterns", dependencies: { "two-range-deps": "1.0.0", "@types/is-number": "1.0.0" } },
    stdout: ["+ @types/is-number@1.0.0 (v2.0.0 available)", "+ two-range-deps@1.0.0", "", "3 packages installed"],
    store: ["@types+is-number@1.0.0", "no-deps@1.1.0", "node_modules", "two-range-deps@1.0.0"],
    links: {
      "node_modules/@types/is-number": "@types+is-number@1.0.0",
      "node_modules/two-range-deps": "two-range-deps@1.0.0",
    },
  },
  {
    // no-deps matches `no-*` but `!no-deps` wins
    name: "complex pattern combinations",
    bunfig: ["@types/*", "no-*", "!no-deps", "a-*"],
    packageJson: {
      name: "complex-patterns",
      dependencies: { "two-range-deps": "1.0.0", "a-dep": "1.0.1", "basic-1": "1.0.0" },
    },
    stdout: [
      "+ a-dep@1.0.1 (v1.0.10 available)",
      "+ basic-1@1.0.0",
      "+ two-range-deps@1.0.0",
      "",
      "5 packages installed",
    ],
    store: [
      "@types+is-number@2.0.0",
      "a-dep@1.0.1",
      "basic-1@1.0.0",
      "no-deps@1.1.0",
      "node_modules",
      "two-range-deps@1.0.0",
    ],
    links: {
      "node_modules/@types/is-number": "@types+is-number@2.0.0",
      "node_modules/a-dep": "a-dep@1.0.1",
      "node_modules/basic-1": "basic-1@1.0.0",
      "node_modules/two-range-deps": "two-range-deps@1.0.0",
    },
  },
  {
    name: "workspaces with publicHoistPattern",
    bunfig: ["*types*", "no-deps"],
    packageJson: { name: "workspace-root", workspaces: ["packages/*"], dependencies: { "no-deps": "1.0.0" } },
    files: {
      "packages/pkg1/package.json": JSON.stringify({
        name: "pkg1",
        dependencies: { "@types/is-number": "1.0.0", "a-dep": "1.0.1" },
      }),
      "packages/pkg2/package.json": JSON.stringify({ name: "pkg2", dependencies: { "two-range-deps": "1.0.0" } }),
    },
    nodeModulesDirs: ["node_modules", "packages/pkg1/node_modules", "packages/pkg2/node_modules"],
    stdout: ["+ no-deps@1.0.0 (v2.0.0 available)", "", "4 packages installed"],
    store: ["@types+is-number@1.0.0", "a-dep@1.0.1", "no-deps@1.0.0", "node_modules", "two-range-deps@1.0.0"],
    links: {
      "node_modules/@types/is-number": "@types+is-number@1.0.0",
      "node_modules/no-deps": "no-deps@1.0.0",
      "packages/pkg1/node_modules/@types/is-number": "@types+is-number@1.0.0",
      "packages/pkg1/node_modules/a-dep": "a-dep@1.0.1",
      "packages/pkg2/node_modules/two-range-deps": "two-range-deps@1.0.0",
    },
  },
];

describe("publicHoistPattern", () => {
  test.concurrent.each(cases)(
    "$name",
    async ({ bunfig, npmrc, packageJson, files, nodeModulesDirs, stdout, store, links }) => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { linker: "isolated", publicHoistPattern: bunfig },
        files: {
          "package.json": JSON.stringify(packageJson),
          ...(npmrc === undefined ? {} : { ".npmrc": npmrc }),
          ...files,
        },
      });

      const result = await install(packageDir);
      expect({ ...result, stdout: result.stdout.split("\n") }).toEqual({
        stdout: ["bun install <version> (<revision>)", "", ...stdout],
        stderr: "Saved lockfile",
        exitCode: 0,
      });
      expect(await layout(packageDir, nodeModulesDirs)).toEqual({ store, links });
    },
  );

  describe("error cases", () => {
    const invalid: { name: string; publicHoistPattern: unknown; stderr: string[] }[] = [
      {
        name: "a number",
        publicHoistPattern: 123,
        stderr: [
          "4 | publicHoistPattern = 123",
          "                         ^",
          "error: Expected a string or an array of strings",
          "    at <dir>/bunfig.toml:4:22",
          "",
          "Invalid Bunfig: failed to load bunfig",
        ],
      },
      {
        name: "an array with a boolean",
        publicHoistPattern: ["*types*", true],
        stderr: [
          '4 | publicHoistPattern = ["*types*", true]',
          "                                     ^",
          "error: Expected a string",
          "    at <dir>/bunfig.toml:4:34",
          "",
          "Invalid Bunfig: failed to load bunfig",
        ],
      },
    ];

    test.concurrent.each(invalid)(
      "$name in bunfig fails the install before anything is written",
      async ({ publicHoistPattern, stderr }) => {
        using dir = tempDir("public-hoist-pattern-", {
          "package.json": JSON.stringify({ name: "invalid-pattern", dependencies: { "no-deps": "1.0.0" } }),
          "bunfig.toml": Bun.TOML.stringify({
            install: { registry: registry.registryUrl(), linker: "isolated", publicHoistPattern },
          })!,
        });

        const result = await install(String(dir));
        expect({ ...result, stderr: result.stderr.split("\n") }).toEqual({ stdout: "", stderr, exitCode: 1 });
        expect(await readdirSorted(String(dir))).toEqual(["bunfig.toml", "package.json"]);
      },
    );
  });
});
