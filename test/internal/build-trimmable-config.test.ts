/**
 * Which build configurations link an executable `--trim` can work on (`Config.trimmable`), and that they give the
 * link the map scripts/build/trim/link.ts reads. Configure-time logic only: no compiler and no download.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows } from "harness";
import { join } from "node:path";

import {
  formatConfig,
  linksWithLld,
  resolveConfig,
  type Config,
  type PartialConfig,
  type Toolchain,
} from "../../scripts/build/config.ts";
import { computeFlags, linkerMapOutputs, linkerMapPath, writesLinkerMap } from "../../scripts/build/flags.ts";
import { getProfile, profiles } from "../../scripts/build/profiles.ts";

const buildScript = join(import.meta.dirname, "..", "..", "scripts", "build.ts");

/** Both resolve on every host: a sysroot's path is only recorded, never opened. */
const linux = { os: "linux", arch: "x64", abi: "gnu", linuxSysroot: "/fake/linux-sysroot" } satisfies PartialConfig;
const freebsd = { os: "freebsd", arch: "x64", freebsdSysroot: "/fake/freebsd" } satisfies PartialConfig;

/** A fully-populated fake toolchain: resolveConfig never spawns any of these. */
function mockToolchain(overrides: Partial<Toolchain> = {}): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang",
    cxx: "/fake/llvm/bin/clang++",
    clangVersion: "23.1.1",
    clangResourceDir: "/fake/llvm/lib/clang/23",
    ar: "/fake/llvm/bin/llvm-ar",
    ld: "/fake/llvm/bin/ld.lld",
    ld64Lld: "/fake/llvm/bin/ld64.lld",
    rustLlvmVersion: "23.1.1",
    rustSysroot: undefined,
    rustHostTriple: undefined,
    strip: "/fake/bin/strip",
    llvmStrip: "/fake/llvm/bin/llvm-strip",
    nm: "/fake/llvm/bin/llvm-nm",
    readobj: "/fake/llvm/bin/llvm-readobj",
    objdump: "/fake/llvm/bin/llvm-objdump",
    cxxfilt: "/fake/llvm/bin/llvm-cxxfilt",
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
    nasm: undefined,
    ...overrides,
  } as Toolchain;
}

const resolve = (partial: PartialConfig): Config =>
  resolveConfig({ buildType: "Release", trimmable: true, ...partial }, mockToolchain());

async function build(...args: string[]): Promise<{ stderr: string; exitCode: number }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), buildScript, ...args],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  return { stderr, exitCode };
}

describe.skipIf(isWindows)("trimmable build config", () => {
  const trimmableTargets: PartialConfig[] = [
    linux,
    freebsd,
    { os: "windows", arch: "x64", winsysroot: "/fake/winsysroot" },
    ...(isMacOS ? [] : [{ os: "darwin", arch: "aarch64" } satisfies PartialConfig]),
  ];

  test.each(trimmableTargets)("$os is trimmable and writes a linker map", partial => {
    const cfg = resolve(partial);
    expect(cfg.trimmable).toBe(true);
    expect(linksWithLld(cfg)).toBe(true);
    expect(writesLinkerMap(cfg)).toBe(true);
    expect(linkerMapOutputs(cfg).length).toBeGreaterThan(0);
    expect(formatConfig(cfg, "bun")).toContain("trimmable");
  });

  test("freebsd passes the map flag to the linker", () => {
    const cfg = resolve(freebsd);
    expect(computeFlags(cfg).ldflags).toContain(`-Wl,-Map=${linkerMapPath(cfg)}`);
  });

  test("is off unless asked for", () => {
    expect(resolveConfig({ ...linux, buildType: "Release" }, mockToolchain()).trimmable).toBe(false);
  });

  test("is off in a debug build", () => {
    expect(resolve({ ...linux, buildType: "Debug", asan: false }).trimmable).toBe(false);
  });

  test("is off under asan and valgrind", () => {
    expect(resolve({ ...linux, asan: true }).trimmable).toBe(false);
    expect(resolve({ ...linux, valgrind: true }).trimmable).toBe(false);
  });

  test.skipIf(!isMacOS)("is off with Apple's linker", () => {
    const cfg = resolve({ os: "darwin" });
    expect(linksWithLld(cfg)).toBe(false);
    expect(cfg.trimmable).toBe(false);
  });

  test("only ci-build asks for it", () => {
    expect(getProfile("ci-build").trimmable).toBe(true);
    const askers = Object.entries(profiles).filter(([, profile]) => "trimmable" in profile);
    expect(askers.map(([name]) => name)).toEqual(["ci-build"]);
  });

  test.concurrent("--trimmable is a config flag", async () => {
    const { exitCode } = await build("--trimmable=on", "--help");
    expect(exitCode).toBe(0);
  });

  test.concurrent("--islands is not a config flag", async () => {
    const { stderr, exitCode } = await build("--islands=on");
    expect(stderr).toContain("Unknown config field: --islands");
    expect(exitCode).toBe(1);
  });
});
