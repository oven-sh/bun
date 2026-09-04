/**
 * The cargo half of the build (scripts/build/rust.ts), configure-time logic
 * only: nothing here runs cargo.
 *
 * - `allRustTargets` is what `bun run rust:check-all` type-checks and what the
 *   generated .cargo/config.toml gets entries for, so a platform CI builds
 *   that is missing from it is one whose cfg-gated code nothing checks before
 *   the CI build itself. Its source of truth is the build matrix in
 *   .buildkite/ci.mjs, which can't be imported (it generates the pipeline on
 *   import), so it is read as text.
 * - The rustflags put the Rust half of the binary on the CPU baseline the C++
 *   half is compiled for (`cpuTargetFlags` in scripts/build/flags.ts).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  resolveConfig,
  type Abi,
  type Arch,
  type Config,
  type OS,
  type PartialConfig,
  type Toolchain,
} from "../../../scripts/build/config.ts";
import {
  allRustTargets,
  cargoBuildInvocation,
  cargoBuildStdArg,
  rustTargetIsTier3,
  rustTriple,
} from "../../../scripts/build/rust.ts";

const repoRoot = join(import.meta.dir, "..", "..", "..");

/** A fully-populated fake toolchain; resolveConfig() never spawns any of these. */
const mockToolchain: Toolchain = {
  cc: "/fake/llvm/bin/clang",
  cxx: "/fake/llvm/bin/clang++",
  hostCc: "/fake/llvm/bin/clang",
  hostCxx: "/fake/llvm/bin/clang++",
  clangVersion: "21.1.8",
  clangResourceDir: "/fake/llvm/lib/clang/21",
  ar: "/fake/llvm/bin/llvm-ar",
  ld: "/fake/llvm/bin/ld.lld",
  ld64Lld: "/fake/llvm/bin/ld64.lld",
  rustLld: undefined,
  rustLlvmVersion: "22.1.4",
  strip: "/fake/bin/strip",
  llvmStrip: "/fake/llvm/bin/llvm-strip",
  nm: "/fake/llvm/bin/llvm-nm",
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
};

/**
 * Resolve a release config for a target the way its CI lane does, with fake
 * sysroots where cross-compiling needs one (nothing stats them at configure
 * time).
 */
function resolve(partial: PartialConfig): Config {
  return resolveConfig({ buildType: "Release", ...partial }, mockToolchain);
}

/** Retarget a resolved config to another linux abi; abi=android needs a real NDK to resolve from scratch. */
function withAbi(cfg: Config, abi: Abi): Config {
  return { ...cfg, abi };
}

describe("allRustTargets", () => {
  test("is exactly the set of triples .buildkite/ci.mjs builds", () => {
    const ciScript = readFileSync(join(repoRoot, ".buildkite", "ci.mjs"), "utf8");
    const matrix = /^const buildPlatforms = \[\n([\s\S]*?)^\];/m.exec(ciScript);
    if (matrix === null) throw new Error("buildPlatforms not found in .buildkite/ci.mjs");

    const entries =
      matrix[1]!
        .split("\n")
        .filter(line => !line.trim().startsWith("//"))
        .join("\n")
        .match(/\{[^}]*\}/g) ?? [];
    // CI builds x64 and aarch64 for each of linux, darwin, windows and
    // freebsd; fewer entries than that means the extraction above broke.
    expect(entries.length).toBeGreaterThanOrEqual(8);

    const built = entries.map(entry => {
      const field = (name: string) => new RegExp(`\\b${name}: "([^"]+)"`).exec(entry)?.[1];
      const os = field("os") as OS;
      const arch = field("arch") as Arch;
      // ci.mjs passes `--abi=gnu` to the linux builds that don't name an abi.
      const abi = os === "linux" ? ((field("abi") as Abi | undefined) ?? "gnu") : undefined;
      return rustTriple(os, arch, abi);
    });

    const listed: string[] = [...allRustTargets].sort();
    expect(listed).toEqual([...new Set(built)].sort());
  });

  test("rust-toolchain.toml preinstalls std for exactly the triples that have a prebuilt one", () => {
    const { toolchain } = Bun.TOML.parse(readFileSync(join(repoRoot, "rust-toolchain.toml"), "utf8")) as {
      toolchain: { targets: string[] };
    };
    const prebuilt = allRustTargets.filter(triple => !rustTargetIsTier3(triple));
    expect([...toolchain.targets].sort()).toEqual([...prebuilt].sort());

    // rust:check-all reaches the remaining triples with -Zbuild-std; that path
    // is only exercised if the matrix really contains a Tier 3 triple.
    expect(allRustTargets.filter(rustTargetIsTier3)).toEqual(["aarch64-unknown-freebsd"]);
  });

  test("a Tier 3 target builds std from source with the flag rust:check-all shares", () => {
    // Debug: the only reason left to build std is the missing prebuilt.
    const freebsdArm64 = cargoBuildInvocation(
      resolve({ os: "freebsd", arch: "aarch64", freebsdSysroot: "/fake", buildType: "Debug" }),
    );
    expect(freebsdArm64.triple).toBe("aarch64-unknown-freebsd");
    expect(freebsdArm64.args).toContain(cargoBuildStdArg);

    const freebsdX64 = cargoBuildInvocation(
      resolve({ os: "freebsd", arch: "x64", freebsdSysroot: "/fake", buildType: "Debug" }),
    );
    expect(freebsdX64.triple).toBe("x86_64-unknown-freebsd");
    expect(freebsdX64.args).not.toContain(cargoBuildStdArg);
  });
});

describe("build-std feature set", () => {
  /** The `-Zbuild-std*` args, in order: which std gets built and with which features. */
  function buildStdArgs(cfg: Config): string[] {
    return cargoBuildInvocation(cfg).args.filter(arg => arg.startsWith("-Zbuild-std"));
  }

  // Cargo's default is `panic-unwind,backtrace,default`. `backtrace` is std's
  // in-process symbolizer (gimli/addr2line/object/miniz_oxide, ~200 KB on the
  // unix targets); nothing in the binary reads it (the panic hook in
  // bun_crash_handler captures and reports frames itself, and clippy.toml
  // disallows std::backtrace::Backtrace), so shipped builds leave it out.
  const release = [cargoBuildStdArg, "-Zbuild-std-features=panic-unwind,default"];

  test("release builds drop std's `backtrace` feature on every shipped platform family", () => {
    const linuxX64 = resolve({ os: "linux", arch: "x64", abi: "gnu", linuxSysroot: "/fake" });
    expect(buildStdArgs(linuxX64)).toEqual(release);
    expect(buildStdArgs(withAbi(linuxX64, "musl"))).toEqual(release);
    expect(buildStdArgs(withAbi(linuxX64, "android"))).toEqual(release);
    expect(buildStdArgs(resolve({ os: "darwin", arch: "aarch64", mode: "rust-only" }))).toEqual(release);
    expect(buildStdArgs(resolve({ os: "windows", arch: "x64", winsysroot: "/fake" }))).toEqual(release);
    expect(buildStdArgs(resolve({ os: "freebsd", arch: "x64", freebsdSysroot: "/fake" }))).toEqual(release);
    // Tier 3: builds std from source either way; release still trims it.
    expect(buildStdArgs(resolve({ os: "freebsd", arch: "aarch64", freebsdSysroot: "/fake" }))).toEqual(release);
  });

  test("builds that rebuild std for other reasons keep cargo's default feature set", () => {
    const linuxX64: PartialConfig = { os: "linux", arch: "x64", abi: "gnu", linuxSysroot: "/fake" };
    // release-asan and debug-asan rebuild std for the instrumentation.
    expect(buildStdArgs(resolve({ ...linuxX64, asan: true }))).toEqual([cargoBuildStdArg]);
    expect(buildStdArgs(resolve({ ...linuxX64, buildType: "Debug", asan: true }))).toEqual([cargoBuildStdArg]);
    // A Tier 3 debug build rebuilds std only because there is no prebuilt one.
    const freebsdArm64: PartialConfig = { os: "freebsd", arch: "aarch64", freebsdSysroot: "/fake", buildType: "Debug" };
    expect(buildStdArgs(resolve(freebsdArm64))).toEqual([cargoBuildStdArg]);
    // A plain debug build links the prebuilt std: no build-std args at all.
    expect(buildStdArgs(resolve({ ...linuxX64, buildType: "Debug", asan: false }))).toEqual([]);
  });
});

describe("CPU baseline", () => {
  /** The rustflags that choose the ISA the build assumes. */
  function cpuFlags(cfg: Config): string[] {
    const rustflags = cargoBuildInvocation(cfg).env.CARGO_ENCODED_RUSTFLAGS!.split("\x1f");
    return rustflags.filter(
      flag =>
        flag.startsWith("-Ctarget-cpu=") || flag.startsWith("-Ctarget-feature=") || flag.startsWith("-Ztune-cpu="),
    );
  }

  test("arm64 linux and freebsd assume armv8-a+crc tuned for Ampere, windows armv8-a+crc generic, like the C++ side", () => {
    // flags.ts: `-march=armv8-a+crc -mtune=ampere1`. Naming a CPU instead
    // (this used to be `-Ctarget-cpu=cortex-a72`) also assumes that CPU's
    // aes/sha2/pmuv3, which the C++ side doesn't, and gives every Rust
    // function a different feature set from every C++ function, which LLVM's
    // inliner treats as incompatible under cross-language LTO.
    const expected = ["-Ctarget-cpu=generic", "-Ctarget-feature=+crc", "-Ztune-cpu=ampere1"];

    const linuxGnu = resolve({ os: "linux", arch: "aarch64", abi: "gnu", linuxSysroot: "/fake" });
    expect(cpuFlags(linuxGnu)).toEqual(expected);
    expect(cpuFlags(withAbi(linuxGnu, "musl"))).toEqual(expected);
    expect(cpuFlags(resolve({ os: "freebsd", arch: "aarch64", freebsdSysroot: "/fake" }))).toEqual(expected);
    // clang-cl spells it `/clang:-march=...`; no -mtune there (Windows-on-ARM
    // is Snapdragon, generic tuning like MSVC/Chromium/Rust).
    expect(cpuFlags(resolve({ os: "windows", arch: "aarch64", winsysroot: "/fake" }))).toEqual([
      "-Ctarget-cpu=generic",
      "-Ctarget-feature=+crc",
    ]);
  });

  test("arm64 android assumes armv8-a+crc tuned for Cortex-A78, like the C++ side", () => {
    const android = withAbi(resolve({ os: "linux", arch: "aarch64", abi: "gnu", linuxSysroot: "/fake" }), "android");
    expect(cargoBuildInvocation(android).triple).toBe("aarch64-linux-android");
    expect(cpuFlags(android)).toEqual(["-Ctarget-cpu=generic", "-Ctarget-feature=+crc", "-Ztune-cpu=cortex-a78"]);
  });

  test("darwin arm64 and x64 name the C++ side's CPU model directly", () => {
    // `-mcpu=apple-m1` and `-march=nehalem` (x86 -march values are CPU names)
    // are LLVM CPU names, which `-Ctarget-cpu` takes as-is.
    expect(cpuFlags(resolve({ os: "darwin", arch: "aarch64", mode: "rust-only" }))).toEqual(["-Ctarget-cpu=apple-m1"]);
    expect(cpuFlags(resolve({ os: "darwin", arch: "x64", mode: "rust-only" }))).toEqual(["-Ctarget-cpu=nehalem"]);
    const linuxX64 = resolve({ os: "linux", arch: "x64", abi: "gnu", linuxSysroot: "/fake" });
    expect(cpuFlags(linuxX64)).toEqual(["-Ctarget-cpu=nehalem"]);
    expect(cpuFlags(withAbi(linuxX64, "android"))).toEqual(["-Ctarget-cpu=nehalem"]);
  });
});
