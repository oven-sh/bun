/**
 * The repo-root package.json and the build step that installs it.
 *
 * - npm must accept every dependency spec: `--root-package-manager=npm` runs
 *   `npm install` in the repo root, and npm rejects the `workspace:` protocol.
 * - bun must still take @types/bun and bun-types from the local folders. The
 *   `resolutions` entries do that: `bun install` fails if a folder is missing.
 * - The build installs the root with bun by default, and with npm on request.
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";

import { emitRootInstall, registerCodegenRules } from "../../../scripts/build/codegen.ts";
import { registerDirStamps } from "../../../scripts/build/compile.ts";
import { resolveConfig, type PartialConfig, type Toolchain } from "../../../scripts/build/config.ts";
import { Ninja } from "../../../scripts/build/ninja.ts";

const root = join(import.meta.dirname, "..", "..", "..");

type Manifest = {
  name: string;
  version?: string;
  workspaces?: string[];
  resolutions?: Record<string, string>;
} & Partial<Record<(typeof dependencyFields)[number], Record<string, string>>>;

const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
}

const rootManifest = readManifest(".");
const workspaceDirs = (rootManifest.workspaces ?? []).map(dir => normalize(dir));

describe("package.json", () => {
  test("npm can read every dependency spec in the root and the workspaces", () => {
    const workspaceSpecs = [".", ...workspaceDirs].flatMap(dir => {
      const manifest = readManifest(dir);
      return dependencyFields.flatMap(field =>
        Object.entries(manifest[field] ?? {})
          .filter(([, spec]) => spec.startsWith("workspace:"))
          .map(([name, spec]) => `${join(dir, "package.json")} ${field}.${name}: ${spec}`),
      );
    });
    expect(workspaceSpecs).toEqual([]);
  });

  test("resolutions pin @types/bun and bun-types to the local folders", () => {
    const pins = ["@types/bun", "bun-types"].map(name => {
      const dir = workspaceDirs.find(dir => readManifest(dir).name === name);
      return { name, dir, resolution: rootManifest.resolutions?.[name] };
    });
    expect(pins).toEqual([
      { name: "@types/bun", dir: normalize("packages/@types/bun"), resolution: "workspace:packages/@types/bun" },
      { name: "bun-types", dir: normalize("packages/bun-types"), resolution: "workspace:packages/bun-types" },
    ]);
  });

  test("bun-types has a version, so that bun prune accepts a '*' range for it", () => {
    // Without a version, `bun prune` and `bun dedupe` report a lockfile mismatch (#40393).
    // packages/bun-types/scripts/build.ts writes the real version before a publish.
    expect(readManifest(normalize("packages/bun-types")).version).toBe("0.0.0");
  });
});

const toolchain: Toolchain = {
  cc: "/fake/llvm/bin/clang",
  cxx: "/fake/llvm/bin/clang++",
  hostCc: undefined,
  hostCxx: undefined,
  clangVersion: "21.1.8",
  clangResourceDir: "/fake/llvm/lib/clang/21",
  ar: "/fake/llvm/bin/llvm-ar",
  ranlib: "/fake/llvm/bin/llvm-ranlib",
  ld: "/fake/llvm/bin/ld.lld",
  ld64Lld: "/fake/llvm/bin/ld64.lld",
  rustLld: undefined,
  rustLlvmVersion: "22.1.4",
  strip: "/fake/bin/strip",
  llvmStrip: "/fake/llvm/bin/llvm-strip",
  nm: "/fake/llvm/bin/llvm-nm",
  dsymutil: "/fake/llvm/bin/dsymutil",
  bun: "/fake/bin/bun",
  npm: "/fake/bin/npm",
  jsRuntime: "/fake/bin/bun",
  esbuild: "/fake/bin/esbuild",
  ccache: undefined,
  cmake: "/fake/bin/cmake",
  cargo: undefined,
  cargoHome: undefined,
  rustupHome: undefined,
  msvcLinker: undefined,
  rc: undefined,
  mt: undefined,
  nasm: undefined,
};

/** The build.ninja text for the root install step, for a linux-x64 debug target. */
function rootInstallNinja(partial: PartialConfig, tc: Toolchain = toolchain): { rule: string; text: string } {
  using dir = tempDir("root-install", {});
  const buildDir = String(dir);
  const cfg = resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType: "Debug", buildDir, linuxSysroot: buildDir, ...partial },
    tc,
  );
  const n = new Ninja({ buildDir });
  registerDirStamps(n, cfg);
  registerCodegenRules(n, cfg);
  emitRootInstall(n, cfg);
  // A long build line continues on the next line after a trailing `$`.
  const text = n.toString().replace(/\$\n\s*/g, "");
  const edge = text.split("\n").find(line => line.startsWith("build ") && line.includes("stamps/install_"));
  return { rule: edge?.match(/: (\S+) /)?.[1] ?? "", text };
}

describe("root install step", () => {
  test("uses bun by default", () => {
    const { rule, text } = rootInstallNinja({});
    expect(rule).toBe("bun_install");
    expect(text).not.toContain("rule npm_install");
  });

  test("uses npm with rootPackageManager=npm", () => {
    const { rule, text } = rootInstallNinja({ rootPackageManager: "npm" });
    expect(rule).toBe("npm_install");
    expect(text).toContain(
      "command = cd $dir && rm -rf node_modules && /fake/bin/npm install --no-save --no-package-lock --include=dev --no-audit --no-fund && touch $stamp",
    );
  });

  test("rejects an unknown package manager, and npm without an npm path", () => {
    expect(() => rootInstallNinja({ rootPackageManager: "yarn" as "npm" })).toThrow("Unknown rootPackageManager: yarn");
    expect(() => rootInstallNinja({ rootPackageManager: "npm" }, { ...toolchain, npm: undefined })).toThrow(
      "rootPackageManager=npm needs toolchain.npm",
    );
  });
});
