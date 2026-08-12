/**
 * scripts/build.ts hands ninja the environment from configure.ts's
 * buildEnv(). Every stream.ts wrapper, fetch-cli.ts and src/codegen script
 * ninja runs is a bun process, and by default each of them starts
 * numberOfGCMarkers - 1 (7 on an 8+ core host) HeapHelper threads at its first
 * GC. A cold build starts about twenty of them at once, which pushed a
 * container with a 512 task pids limit over the limit; pthread_create then
 * failed inside the helpers and WTF::Thread::create aborted them ("abort()
 * called" from fetch-cli.ts and cppbind.ts on the first `bun bd` in a fresh
 * container). buildEnv() caps the helpers at one GC marker.
 *
 * The option is parsed by whichever bun runs the helpers, and bun exits on a
 * BUN_JSC_ variable it does not recognize, so besides pinning the env this
 * runs the bun under test with it: the option name must still exist and it
 * must still remove the helper threads.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";

import { resolveConfig, type Config, type Toolchain } from "../../scripts/build/config.ts";
import { buildEnv } from "../../scripts/build/configure.ts";

/** A fully-populated fake toolchain; resolveConfig never spawns any of these. */
function mockToolchain(overrides: Partial<Toolchain> = {}): Toolchain {
  return {
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
    rustSysroot: undefined,
    rustHostTriple: undefined,
    strip: "/fake/bin/strip",
    llvmStrip: "/fake/llvm/bin/llvm-strip",
    dsymutil: "/fake/llvm/bin/dsymutil",
    bun: "/fake/bin/bun",
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
    ...overrides,
  };
}

/** A host-targeted config rooted in `dir` (build dir and cache dir), so nothing outside the temp dir is referenced. */
function hostConfig(dir: string, toolchain: Toolchain = mockToolchain()): Config {
  return resolveConfig({ buildDir: dir, cacheDir: dir }, toolchain);
}

/**
 * Mirrors a build helper: a script file (not `-e`, which bun already runs
 * with a single GC marker), a full GC, then the names of the process's
 * threads. JSC names its parallel markers "HeapHelper" on Linux.
 */
const threadNamesFixture = `
  import { readdirSync, readFileSync } from "node:fs";
  Bun.gc(true);
  const names = readdirSync("/proc/self/task").map(tid => readFileSync("/proc/self/task/" + tid + "/comm", "utf8").trim());
  console.log(JSON.stringify(names));
`;

async function threadNames(extraEnv: Record<string, string>): Promise<string[]> {
  using dir = tempDir("build-ninja-env", { "helper.ts": threadNamesFixture });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "helper.ts"],
    cwd: String(dir),
    env: { ...bunEnv, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

describe("buildEnv", () => {
  test("caps the build's bun helper processes at one GC marker", () => {
    using dir = tempDir("build-ninja-env", {});
    expect(buildEnv(hostConfig(String(dir)))).toEqual({ BUN_JSC_numberOfGCMarkers: "1" });
  });

  test("keeps the ccache variables alongside it", () => {
    using dir = tempDir("build-ninja-env", {});
    expect(buildEnv(hostConfig(String(dir), mockToolchain({ ccache: "/fake/bin/ccache" })))).toMatchObject({
      CCACHE_DIR: resolve(String(dir), "ccache"),
      BUN_JSC_numberOfGCMarkers: "1",
    });
  });

  test.concurrent("the bun under test accepts the environment", async () => {
    using dir = tempDir("build-ninja-env", { "helper.ts": `console.log("ok");` });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "helper.ts"],
      cwd: String(dir),
      env: { ...bunEnv, ...buildEnv(hostConfig(String(dir))) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ok\n");
    expect(exitCode).toBe(0);
  });

  // Thread names come from /proc. The control needs a host where JSC's
  // default (min(cores, 8) markers) starts at least one helper.
  test.concurrent.skipIf(!isLinux || availableParallelism() < 2)(
    "without it a helper script starts parallel GC marker threads",
    async () => {
      expect(await threadNames({})).toContain("HeapHelper");
    },
  );

  test.concurrent.skipIf(!isLinux)("with it a helper script starts none", async () => {
    using dir = tempDir("build-ninja-env", {});
    expect(await threadNames(buildEnv(hostConfig(String(dir))))).not.toContain("HeapHelper");
  });
});
