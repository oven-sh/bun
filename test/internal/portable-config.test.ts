/**
 * Build-config tests for the portable image (`--portable`, scripts/build/config.ts `portable`): one static-pie
 * musl executable whose code uses no red zone, no native thread-local instructions and no dynamic loader.
 *
 * Configure-time logic only: no compiler runs and the sysroot is a directory of empty files, so these run on
 * every host. What the flags produce is checked on a built binary, not here.
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";

import { binaryExpectations } from "../../scripts/build/binary-expectations.ts";
import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { boringssl } from "../../scripts/build/deps/boringssl.ts";
import { mimalloc } from "../../scripts/build/deps/mimalloc.ts";
import { tinycc } from "../../scripts/build/deps/tinycc.ts";
import { webkit } from "../../scripts/build/deps/webkit.ts";
import { computeDepFlags, computeFlags } from "../../scripts/build/flags.ts";
import { getProfile } from "../../scripts/build/profiles.ts";
import { cargoBuildInvocation, rustTarget } from "../../scripts/build/rust.ts";
import type { DirectBuild, NestedCmakeBuild } from "../../scripts/build/source.ts";

/** A fully-populated fake toolchain; resolveConfig never spawns any of these. */
function mockToolchain(): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang",
    cxx: "/fake/llvm/bin/clang++",
    hostCc: undefined,
    hostCxx: undefined,
    clangVersion: "23.1.2",
    clangResourceDir: "/fake/llvm/lib/clang/23",
    ar: "/fake/llvm/bin/llvm-ar",
    ranlib: "/fake/llvm/bin/llvm-ranlib",
    ld: "/fake/llvm/bin/ld.lld",
    ld64Lld: "/fake/llvm/bin/ld64.lld",
    rustLld: undefined,
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
    mt: undefined,
    nasm: undefined,
  };
}

/** Every file configure looks for in a portable sysroot, empty. */
const sysrootFiles = {
  "usr/lib/libc.a": "",
  "usr/lib/rcrt1.o": "",
  "usr/lib/libc++.a": "",
  "usr/lib/libunwind.a": "",
  "usr/lib/libicuuc.a": "",
  "usr/include/c++/v1/vector": "",
  "clang-resource-dir/include/stddef.h": "",
  "clang-resource-dir/lib/x86_64-unknown-linux-musl/libclang_rt.builtins.a": "",
};

function portableConfig(sysroot: string, partial: PartialConfig = {}): Config {
  return resolveConfig(
    { ...getProfile("portable"), portableSysroot: sysroot, buildDir: join(sysroot, "build"), ...partial },
    mockToolchain(),
  );
}

/** The same machine and build type without the option: what must not change. */
function plainConfig(dir: string, partial: PartialConfig = {}): Config {
  return resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType: "Release", buildDir: dir, linuxSysroot: dir, ...partial },
    mockToolchain(),
  );
}

describe("portable image config", () => {
  test("is a musl target with a local WebKit, no TinyCC, no sanitizer, that the build host can run", () => {
    using dir = tempDir("portable-config", sysrootFiles);
    const cfg = portableConfig(String(dir));
    expect({
      portable: cfg.portable,
      os: cfg.os,
      abi: cfg.abi,
      crossTarget: cfg.crossTarget,
      sysroot: cfg.sysroot,
      rust: rustTarget(cfg),
      webkit: cfg.webkit,
      tinycc: cfg.tinycc,
      asan: cfg.asan,
      lto: cfg.lto,
    }).toEqual({
      portable: true,
      os: "linux",
      abi: "musl",
      crossTarget: "x86_64-linux-musl",
      sysroot: String(dir),
      rust: "x86_64-unknown-linux-musl",
      webkit: "local",
      tinycc: false,
      asan: false,
      lto: false,
    });
    expect(tinycc.enabled!(cfg)).toBe(false);
    // A static executable runs on any Linux kernel of its architecture, whatever libc the host has.
    expect(cfg.canRunOnHost).toBe(process.platform === "linux" && process.arch === "x64");
    // Debug builds default ASAN on for Linux; the image has none.
    expect(portableConfig(String(dir), { buildType: "Debug" }).asan).toBe(false);
  });

  test("refuses what it cannot be", () => {
    using dir = tempDir("portable-config", sysrootFiles);
    const sysroot = String(dir);
    expect(() => portableConfig(sysroot, { arch: "aarch64" })).toThrow(/linux-x64 only/);
    expect(() => portableConfig(sysroot, { os: "darwin" })).toThrow(/linux-x64 only/);
    expect(() => portableConfig(sysroot, { abi: "gnu" })).toThrow(/musl target/);
    expect(() => portableConfig(sysroot, { webkit: "prebuilt" })).toThrow(/locally built WebKit/);
    expect(() => portableConfig(sysroot, { tinycc: true })).toThrow(/tinycc/);
  });

  test("names what an incomplete sysroot is missing", () => {
    const { "usr/lib/rcrt1.o": _, ...incomplete } = sysrootFiles;
    using dir = tempDir("portable-config", incomplete);
    expect(() => portableConfig(String(dir))).toThrow(/incomplete/);
    try {
      portableConfig(String(dir));
    } catch (error) {
      expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).toContain("rcrt1.o");
    }
  });

  test("C and C++ are compiled without a red zone, with emulated TLS, position independent", () => {
    using dir = tempDir("portable-config", sysrootFiles);
    const cfg = portableConfig(String(dir));
    const sysroot = String(dir);
    const own = computeFlags(cfg);
    const deps = computeDepFlags(cfg);
    for (const flags of [own.cflags, own.cxxflags, deps.cflags, deps.cxxflags]) {
      expect(flags).toContain("--target=x86_64-linux-musl");
      expect(flags).toContain(`--sysroot=${sysroot}`);
      expect(flags).toContain(`-resource-dir=${join(sysroot, "clang-resource-dir")}`);
      expect(flags).toContain("-mno-red-zone");
      expect(flags).toContain("-femulated-tls");
      expect(flags).toContain("-fno-stack-protector");
      expect(flags.filter(f => f.startsWith("-fsanitize"))).toBeEmpty();
    }
    for (const flags of [own.cxxflags, deps.cxxflags]) {
      expect(flags).toContain("-stdlib++-isystem");
      expect(flags).toContain(join(sysroot, "usr", "include", "c++", "v1"));
      // Replaced by -stdlib++-isystem for a compile; with it clang warns that it is unused, and bun is -Werror.
      expect(flags).not.toContain("-stdlib=libc++");
    }
    // bun's own objects: PIE, and none of the position-dependent flags of the other Linux targets.
    expect(own.cxxflags).toContain("-fPIE");
    expect(own.cxxflags).not.toContain("-fno-pic");
    expect(own.cxxflags).not.toContain("-fno-pie");
    expect(own.defines).toContain("BUN_PORTABLE=1");
  });

  test("the link is a static-pie against the sysroot's runtimes, with 64 KiB segments", () => {
    using dir = tempDir("portable-config", sysrootFiles);
    const cfg = portableConfig(String(dir));
    const { ldflags } = computeFlags(cfg);
    expect(ldflags).toContain("-static-pie");
    expect(ldflags).toContain("-rtlib=compiler-rt");
    expect(ldflags).toContain("-unwindlib=libunwind");
    expect(ldflags).toContain("-stdlib=libc++");
    expect(ldflags).toContain(`-resource-dir=${join(String(dir), "clang-resource-dir")}`);
    expect(ldflags).toContain("-Wl,-z,max-page-size=65536");
    expect(ldflags).toContain("-Wl,-z,separate-loadable-segments");
    // The crates reach the link as bitcode: the linker generates their code and has to be told the TLS model.
    expect(ldflags).toContain("-Wl,-mllvm,-emulated-tls");
    // Not the other Linux targets' link.
    expect(ldflags).not.toContain("-Wl,-no-pie");
    expect(ldflags).not.toContain("-lstdc++");
    expect(ldflags).not.toContain("-static-libstdc++");
    expect(ldflags.filter(f => f.startsWith("-Wl,--wrap=")).sort()).toEqual([
      "-Wl,--wrap=execve",
      "-Wl,--wrap=pthread_create",
    ]);
  });

  test("Rust is compiled the same way, and rustix through libc", () => {
    using dir = tempDir("portable-config", sysrootFiles);
    const { rustflags, triple } = cargoBuildInvocation(portableConfig(String(dir)));
    expect(triple).toBe("x86_64-unknown-linux-musl");
    expect(rustflags).toContain("-Crelocation-model=pie");
    expect(rustflags).not.toContain("-Crelocation-model=static");
    expect(rustflags).toContain("-Ctarget-feature=+crt-static");
    expect(rustflags).toContain("-Cno-redzone=yes");
    expect(rustflags).toContain("-Ztls-model=emulated");
    expect(rustflags).toContain("--cfg=bun_portable");
    expect(rustflags).toContain("--cfg=rustix_use_libc");
  });

  test("mimalloc keeps its heap in a pthread key and takes its thread id from pthread_self", () => {
    using dir = tempDir("portable-config", sysrootFiles);
    const cfg = portableConfig(String(dir));
    const spec = mimalloc.build(cfg) as DirectBuild;
    expect(spec.defines).toMatchObject({ MI_LIBC_MUSL: 1, MI_TLS_MODEL_PTHREADS: 1, MI_MALLOC_OVERRIDE: true });
    expect(spec.cflags).toContain("-DMI_PRIM_THREAD_ID=pthread_self");
    expect(spec.cflags!.filter(f => f.startsWith("-ftls-model"))).toBeEmpty();
    expect((mimalloc.patches as (cfg: Config) => string[])(cfg)).toEqual([
      "patches/mimalloc/portable-theap-null-in-new.patch",
    ]);
  });

  test("BoringSSL leaves out the assembly that uses the red zone", () => {
    using dir = tempDir("portable-config", sysrootFiles);
    const cfg = portableConfig(String(dir));
    expect((boringssl.build(cfg) as DirectBuild).defines).toMatchObject({ BORINGSSL_NO_RED_ZONE: true });
    expect((boringssl.patches as (cfg: Config) => string[])(cfg)).toEqual([
      "patches/boringssl/portable-no-red-zone-asm.patch",
    ]);
  });

  test("WebKit is built with the image's flags, the libraries only", () => {
    using dir = tempDir("portable-config", sysrootFiles);
    const cfg = portableConfig(String(dir));
    const spec = webkit.build(cfg) as NestedCmakeBuild;
    expect(spec.kind).toBe("nested-cmake");
    expect(spec.targets).toEqual(["JavaScriptCore", "WTF", "bmalloc"]);
    for (const flags of [spec.args.CMAKE_C_FLAGS!, spec.args.CMAKE_CXX_FLAGS!]) {
      const list = flags.split(" ");
      expect(list).toContain("--target=x86_64-linux-musl");
      expect(list).toContain("-mno-red-zone");
      expect(list).toContain("-femulated-tls");
      expect(list).toContain("-fPIE");
      expect(list).toContain("-fno-omit-frame-pointer");
      expect(list).not.toContain("-fno-pic");
    }
    expect(spec.args.CMAKE_EXE_LINKER_FLAGS).toContain("-static-pie");
    expect(spec.args.ICU_ROOT).toBe(join(String(dir), "usr"));
  });

  test("the executable is expected to be static: no loader, no libraries, no TLS segment", () => {
    using dir = tempDir("portable-config", sysrootFiles);
    const expectations = binaryExpectations(portableConfig(String(dir)));
    expect(expectations.neededLibs).toMatchObject({ names: [], exact: true });
    expect(expectations.elf).toMatchObject({ type: "DYN", tlsSegment: false, interpreter: false });
    expect(expectations.staticInitializers).toEqual(["_ZL17mi_process_attachv", "__do_init"]);
  });
});

describe("without --portable", () => {
  test("no flag of the portable image reaches another Linux target", () => {
    using dir = tempDir("portable-config", {});
    const configs: Config[] = [
      plainConfig(String(dir)),
      plainConfig(String(dir), { buildType: "Debug" }),
      // A musl target finds its sysroot through the environment; what the flag tables read is stated directly.
      { ...plainConfig(String(dir)), abi: "musl" },
    ];
    for (const resolved of configs) {
      expect(resolved.portable).toBe(false);
      const own = computeFlags(resolved);
      const deps = computeDepFlags(resolved);
      const all = [...own.cflags, ...own.cxxflags, ...own.ldflags, ...deps.cflags, ...deps.cxxflags];
      for (const flag of [
        "-mno-red-zone",
        "-femulated-tls",
        "-fPIE",
        "-static-pie",
        "-stdlib++-isystem",
        "-Wl,-z,max-page-size=65536",
        "-Wl,-z,separate-loadable-segments",
        "-Wl,-mllvm,-emulated-tls",
      ]) {
        expect(all).not.toContain(flag);
      }
      expect(own.defines).not.toContain("BUN_PORTABLE=1");

      const { rustflags } = cargoBuildInvocation(resolved);
      expect(rustflags).toContain("-Crelocation-model=static");
      // Declared everywhere, so that `cfg(bun_portable)` in a source file is a known name; set only by --portable.
      expect(rustflags).toContain("--check-cfg=cfg(bun_portable)");
      for (const flag of ["--cfg=bun_portable", "--cfg=rustix_use_libc", "-Cno-redzone=yes", "-Ztls-model=emulated"]) {
        expect(rustflags).not.toContain(flag);
      }

      expect((mimalloc.patches as (cfg: Config) => string[])(resolved)).toEqual([]);
      expect((boringssl.patches as (cfg: Config) => string[])(resolved)).toEqual([]);
      expect((mimalloc.build(resolved) as DirectBuild).defines).not.toHaveProperty("MI_TLS_MODEL_PTHREADS");
      expect((boringssl.build(resolved) as DirectBuild).defines).not.toHaveProperty("BORINGSSL_NO_RED_ZONE");
      expect(binaryExpectations(resolved).elf).not.toHaveProperty("interpreter");
    }
  });
});
