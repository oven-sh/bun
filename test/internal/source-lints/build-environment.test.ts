/**
 * The build sees the caller's variables that scripts/build/env.ts lists and no others.
 *
 * - What the list keeps and drops, for build.ts itself and for the edges.
 * - An edge's PATH is the part of the caller's that configure found tools in.
 * - A build script that reads a variable by name reads one an edge can see: one that is not on the list is
 *   undefined in every build, which nothing else would point out.
 */
import { Glob } from "bun";
import { afterEach, describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { chmodSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import {
  ciServicePrefixes,
  edgeEnvironment,
  inheritedVariables,
  isInherited,
  restrictEnvironment,
} from "../../../scripts/build/env.ts";
import { edgeSearchPath, findNamedPrograms } from "../../../scripts/build/tools.ts";

const repoRoot = join(import.meta.dir, "..", "..", "..");

/** Each changes what a tool the build runs does, without appearing in any command. */
const readByTools = {
  CPATH: "/hostile/include",
  C_INCLUDE_PATH: "/hostile/include",
  CPLUS_INCLUDE_PATH: "/hostile/include",
  CCC_OVERRIDE_OPTIONS: "+-O0",
  COMPILER_PATH: "/hostile/bin",
  LIBRARY_PATH: "/hostile/lib",
  LINK: "/hostile",
  _LINK_: "/hostile",
  SOURCE_DATE_EPOCH: "1",
  MACOSX_DEPLOYMENT_TARGET: "1.0",
  SDKROOT: "/hostile/sdk",
  CC: "/bin/false",
  CXX: "/bin/false",
  CFLAGS: "-O0",
  CXXFLAGS: "-O0",
  LDFLAGS: "-hostile",
  RUSTFLAGS: "--cfg hostile",
  CARGO_ENCODED_RUSTFLAGS: "--cfg\x1fhostile",
  CARGO_TARGET_DIR: "/hostile/target",
  CARGO_BUILD_TARGET: "hostile-triple",
  RUSTUP_TOOLCHAIN: "stable",
  RUSTC: "/bin/false",
  GIT_DIR: "/hostile/git",
  TAR_OPTIONS: "--hostile",
  PERL5OPT: "-Mhostile",
  NODE_OPTIONS: "--require=/hostile.js",
  ASAN_OPTIONS: "detect_leaks=1",
};

describe("the environment of an edge", () => {
  test("has none of the variables tools read on their own", () => {
    expect(edgeEnvironment(readByTools, { PATH: "/tools" })).toEqual({ PATH: "/tools" });
  });

  test("has configure's PATH, not the caller's", () => {
    expect(edgeEnvironment({ PATH: "/home/me/bin:/tools" }, { PATH: "/tools" })).toEqual({ PATH: "/tools" });
  });

  test("has the listed variables that are set, and Nix's", () => {
    const env = {
      HOME: "/home/me",
      BUN_TOOLCHAIN_LLVM: "/opt/llvm",
      NIX_CFLAGS_COMPILE: "-isystem /nix",
      TERM: undefined,
    };
    expect(edgeEnvironment(env, { PATH: "/tools" })).toEqual({
      HOME: "/home/me",
      BUN_TOOLCHAIN_LLVM: "/opt/llvm",
      NIX_CFLAGS_COMPILE: "-isystem /nix",
      PATH: "/tools",
    });
  });

  test("has what configure adds, over what was inherited", () => {
    const added = { PATH: "/tools", CCACHE_DIR: "/cache", TMPDIR: "/build/tmp" };
    expect(edgeEnvironment({ TMPDIR: "/tmp" }, added)).toEqual(added);
  });

  test("has nothing of the CI service's but what configure reads", () => {
    const env = {
      BUILDKITE: "true",
      BUILDKITE_COMMIT: "abc",
      BUILDKITE_AGENT_ACCESS_TOKEN: "secret",
      BUILDKITE_JOB_ID: "1",
      GITHUB_TOKEN: "secret",
    };
    expect(edgeEnvironment(env, { PATH: "/tools" })).toEqual({
      BUILDKITE: "true",
      BUILDKITE_COMMIT: "abc",
      PATH: "/tools",
    });
  });
});

describe("the environment of build.ts", () => {
  test("keeps the listed variables, PATH and the CI service's, and drops the rest", () => {
    const kept = { HOME: "/home/me", PATH: "/usr/bin", BUILDKITE_AGENT_ACCESS_TOKEN: "secret", GITHUB_TOKEN: "secret" };
    const env: Record<string, string | undefined> = { ...kept, ...readByTools };
    restrictEnvironment(env);
    expect(env).toEqual(kept);
  });
});

describe("the PATH of an edge", () => {
  const callerPath = process.env.PATH;
  afterEach(() => {
    process.env.PATH = callerPath;
  });

  test("is the caller's directories that a tool was found in, in the caller's order", () => {
    process.env.PATH = ["/shims", "/b/bin", "/unused", "/a/bin/", "/b/bin"].join(delimiter);
    const path = edgeSearchPath(["/a/bin/clang", undefined, "/b/bin/git", "/elsewhere/cmake"]);
    expect(path).toBe(["/b/bin", "/a/bin/", "/b/bin"].join(delimiter));

    // The `regen` edge configures on this PATH, and gives the edges after it the same one.
    process.env.PATH = path;
    expect(edgeSearchPath(["/a/bin/clang", undefined, "/b/bin/git", "/elsewhere/cmake"])).toBe(path);
  });

  test.skipIf(isWindows)("has every program the build runs by name, or configure fails naming who runs it", () => {
    const programs = ["sh", "mkdir", "touch", "git", "tar", "gzip", "ld"];
    using dir = tempDir("build-named-programs", Object.fromEntries(programs.map(name => [`bin/${name}`, ""])));
    for (const name of programs) chmodSync(join(String(dir), "bin", name), 0o755);
    process.env.PATH = join(String(dir), "bin");

    const needs = { darwinTarget: false, localWebKit: false };
    expect(() => findNamedPrograms("linux", needs)).toThrow(
      expect.objectContaining({
        message: "Could not find perl",
        hint: expect.stringContaining("create-hash-table.ts"),
      }),
    );
  });

  test.skipIf(isWindows)("has what only some builds run when this one does", () => {
    const programs = ["sh", "mkdir", "touch", "git", "tar", "gzip", "perl", "ld"];
    using dir = tempDir("build-named-programs", Object.fromEntries(programs.map(name => [`bin/${name}`, ""])));
    for (const name of programs) chmodSync(join(String(dir), "bin", name), 0o755);
    process.env.PATH = join(String(dir), "bin");

    expect(findNamedPrograms("linux", { darwinTarget: false, localWebKit: false })).toEqual(
      programs.map(name => join(String(dir), "bin", name)),
    );
    expect(() => findNamedPrograms("linux", { darwinTarget: true, localWebKit: false })).toThrow(
      "Could not find nproc",
    );
    expect(() => findNamedPrograms("linux", { darwinTarget: false, localWebKit: true })).toThrow(
      "Could not find ninja",
    );
  });
});

/** `process.env.NAME` in the text of a build script that is not the build reading the caller's `NAME`. */
const notInherited: Record<string, string> = {
  PATH: "the caller's in build.ts, configure's cut of it in an edge",
  TARGET_PLATFORM: "set in the codegen rule's command",
  TARGET_ARCH: "set in the codegen rule's command",
  NINJA_EARLY_OUTPUT_PREFIX: "set by ninja for the edge",
  NODE_ENV: "the name of a bundler define",
  TRACE: "in the text of generated code (client-js.ts)",
  SHOW_PID: "in the text of generated code (client-js.ts)",
  ASSERT: "in the text of generated code (client-js.ts)",
  XMAC_CACHE_DIR: "xmac.mjs's default for a flag the build passes",
  XMAC_CATALOG: "xmac.mjs's default for a flag the build leaves alone",
};

test("a variable a build script reads by name is one the build can see", () => {
  const files = [
    "scripts/build.ts",
    "scripts/glob-sources.ts",
    ...new Glob("scripts/build/**/*.{ts,mjs}").scanSync(repoRoot),
    ...new Glob("src/codegen/**/*.ts").scanSync(repoRoot),
  ];
  const unseen: string[] = [];
  for (const file of files) {
    const text = readFileSync(join(repoRoot, file), "utf8");
    const reads = text.matchAll(/\b(?:process|Bun)\.env(?:\.([A-Za-z_]\w*)|\[\s*["'`](\w+)["'`]\s*\])/g);
    for (const [, dotted, quoted] of reads) {
      const name = (dotted ?? quoted)!;
      if (isInherited(name) || name in notInherited) continue;
      // ci.ts is build.ts's report to the CI service, outside ninja.
      if (file === "scripts/build/ci.ts" && ciServicePrefixes.some(p => name.startsWith(p))) continue;
      unseen.push(`${file}: ${name}`);
    }
  }
  expect(unseen).toEqual([]);
});

test("the list names each variable once", () => {
  expect([...new Set<string>(inheritedVariables)]).toEqual([...inheritedVariables]);
});
