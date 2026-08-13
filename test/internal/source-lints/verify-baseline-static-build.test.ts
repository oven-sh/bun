/**
 * Configure-time tests for scripts/build/verify-baseline-static.ts: the CI
 * build (`--verify-baseline-static=on`, passed by .buildkite/ci.mjs for every
 * target that gets a verify-baseline step) cross-builds the static ISA scanner
 * for the host that step runs on and uploads it, so the step no longer installs
 * a rust toolchain and fetches the scanner's crates on a test-fleet image.
 *
 * Nothing here runs cargo; these pin down the cargo invocation the edge is
 * emitted with (target triple, linker, rustflags) and the artifact contract
 * with ci.mjs. The windows cases describe a windows target built on a linux
 * host, which is the only way CI builds windows; on a windows host the same
 * inputs resolve to the native toolchain, so they are skipped there.
 */
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { join, relative, resolve } from "node:path";

import { verifyBaselineStaticArtifact } from "../../../scripts/build/ci.ts";
import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../../scripts/build/config.ts";
import { Ninja } from "../../../scripts/build/ninja.ts";
import { rustLibPath, rustTarget } from "../../../scripts/build/rust.ts";
import { registerDepRules } from "../../../scripts/build/source.ts";
import {
  emitVerifyBaselineStatic,
  verifyBaselineStaticExe,
  verifyBaselineStaticInvocation,
  verifyBaselineStaticTriple,
} from "../../../scripts/build/verify-baseline-static.ts";
import { ucrtServicingLibDir } from "../../../scripts/build/winsysroot.ts";
import { globAllSources, type Sources } from "../../../scripts/glob-sources.ts";

const repoRoot = resolve(import.meta.dir, "..", "..", "..");
const checkerDir = resolve(repoRoot, "scripts", "verify-baseline-static");

/** A fully-populated fake toolchain; resolveConfig records these paths without spawning them. */
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
    ld64Lld: undefined,
    rustLld: undefined,
    rustLlvmVersion: "21.1.0",
    rustSysroot: undefined,
    rustHostTriple: undefined,
    strip: "/fake/bin/strip",
    llvmStrip: "/fake/llvm/bin/llvm-strip",
    dsymutil: undefined,
    bun: "/fake/bin/bun",
    jsRuntime: "/fake/bin/bun",
    esbuild: "/fake/bin/esbuild",
    ccache: undefined,
    cmake: "/fake/bin/cmake",
    cargo: "/fake/rust/bin/cargo",
    cargoHome: "/fake/rust/cargo-home",
    rustupHome: "/fake/rust/rustup-home",
    msvcLinker: undefined,
    rc: undefined,
    mt: undefined,
    nasm: undefined,
    ...overrides,
  };
}

/** What `--profile=ci-build --os=linux --arch=<arch> --abi=gnu` resolves to (the sysroot path is only recorded). */
function linuxCi(partial: PartialConfig = {}, toolchain = mockToolchain()): Config {
  return resolveConfig(
    {
      os: "linux",
      arch: "x64",
      abi: "gnu",
      buildType: "Release",
      ci: true,
      buildkite: false,
      linuxSysroot: "/fake/linux-sysroot",
      verifyBaselineStatic: true,
      ...partial,
    },
    toolchain,
  );
}

/** The windows lane: a windows target cross-built on the linux build host, with an xwin splat. */
function windowsCi(partial: PartialConfig = {}, toolchain?: Toolchain): Config {
  return resolveConfig(
    {
      os: "windows",
      arch: "x64",
      buildType: "Release",
      ci: true,
      buildkite: false,
      winsysroot: "/fake/winsysroot",
      verifyBaselineStatic: true,
      ...partial,
    },
    toolchain ??
      mockToolchain({
        cc: "/fake/llvm/bin/clang-cl",
        cxx: "/fake/llvm/bin/clang-cl",
        ar: "/fake/llvm/bin/llvm-lib",
        ld: "/fake/llvm/bin/lld-link",
        rc: "/fake/llvm/bin/llvm-rc",
      }),
  );
}

function rustflagsOf(cfg: Config): string[] {
  return verifyBaselineStaticInvocation(cfg).env.CARGO_ENCODED_RUSTFLAGS!.split("\x1f");
}

describe("verifyBaselineStatic config flag", () => {
  test("off unless asked for; ci.mjs turns it on per target", () => {
    expect(linuxCi({ verifyBaselineStatic: undefined }).verifyBaselineStatic).toBe(false);
    expect(linuxCi().verifyBaselineStatic).toBe(true);
  });
});

describe("target triple: the verify-baseline step's host, not bun's own target", () => {
  test("every linux lane gets a musl-static scanner for its arch, whatever libc bun targets", () => {
    // getVerifyBaselineHost() in ci.mjs puts glibc and android builds on a
    // debian host and musl builds on an alpine host; one static musl binary
    // per arch runs on both, so the abi never enters into it (android resolves
    // through the same `cfg.linux` branch; it needs an NDK to configure, so
    // gnu stands in for it here).
    const x64 = linuxCi();
    expect(rustTarget(x64)).toBe("x86_64-unknown-linux-gnu");
    expect(verifyBaselineStaticTriple(x64)).toBe("x86_64-unknown-linux-musl");

    const aarch64 = linuxCi({ arch: "aarch64" });
    expect(rustTarget(aarch64)).toBe("aarch64-unknown-linux-gnu");
    expect(verifyBaselineStaticTriple(aarch64)).toBe("aarch64-unknown-linux-musl");
  });

  test("the musl lanes' scanner triple is bun's own triple", () => {
    // Configuring a musl target on a glibc host requires a musl sysroot; a
    // stub with the one file detectLinuxMuslSysroot() looks for is enough,
    // the path is only recorded.
    using sysroot = tempDir("vbs-musl-sysroot", { "usr/lib/libc.so": "" });
    const previous = process.env.LINUX_MUSL_SYSROOT;
    process.env.LINUX_MUSL_SYSROOT = String(sysroot);
    try {
      const musl = linuxCi({ arch: "aarch64", abi: "musl", linuxSysroot: undefined });
      expect(rustTarget(musl)).toBe("aarch64-unknown-linux-musl");
      expect(verifyBaselineStaticTriple(musl)).toBe("aarch64-unknown-linux-musl");
    } finally {
      if (previous === undefined) delete process.env.LINUX_MUSL_SYSROOT;
      else process.env.LINUX_MUSL_SYSROOT = previous;
    }
  });

  test.skipIf(isWindows)("windows builds get a pc-windows-msvc scanner", () => {
    expect(verifyBaselineStaticTriple(windowsCi())).toBe("x86_64-pc-windows-msvc");
    expect(verifyBaselineStaticTriple(windowsCi({ arch: "aarch64" }))).toBe("aarch64-pc-windows-msvc");
  });

  test("targets without a verify-baseline step are rejected at configure time", () => {
    const freebsd = resolveConfig(
      {
        os: "freebsd",
        arch: "x64",
        buildType: "Release",
        ci: true,
        buildkite: false,
        freebsdSysroot: "/fake/freebsd-sysroot",
        verifyBaselineStatic: true,
      },
      mockToolchain(),
    );
    expect(() => verifyBaselineStaticTriple(freebsd)).toThrow(/verify-baseline step only exists for linux and windows/);
  });
});

describe("cargo invocation", () => {
  test("builds the locked release binary into its own target dir under deps/", () => {
    const cfg = linuxCi();
    const { args, exe, triple } = verifyBaselineStaticInvocation(cfg);
    const targetDir = resolve(cfg.buildDir, "deps", "verify-baseline-static");
    expect(args).toEqual(["--locked", "--release", "--target-dir", targetDir, "--target", triple]);
    expect(exe).toBe(resolve(targetDir, "x86_64-unknown-linux-musl", "release", "verify-baseline-static"));
    expect(exe).toBe(verifyBaselineStaticExe(cfg));
  });

  test("pins the same rustup toolchain as the rest of the build", () => {
    const cfg = linuxCi();
    const { env } = verifyBaselineStaticInvocation(cfg);
    expect(cfg.rustToolchain).toBeDefined();
    expect(env).toMatchObject({
      RUSTUP_TOOLCHAIN: cfg.rustToolchain!,
      CARGO_HOME: "/fake/rust/cargo-home",
      RUSTUP_HOME: "/fake/rust/rustup-home",
    });
  });

  test("linux links with the build's own lld, invoked directly, as a static executable", () => {
    const cfg = linuxCi();
    expect(verifyBaselineStaticInvocation(cfg).env.CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER).toBe(cfg.ld);
    expect(cfg.ld).toBe("/fake/llvm/bin/ld.lld");
    expect(rustflagsOf(cfg)).toEqual(["-Ctarget-feature=+crt-static", `--remap-path-prefix=${cfg.cwd}=.`]);

    const aarch64 = verifyBaselineStaticInvocation(linuxCi({ arch: "aarch64" })).env;
    expect(aarch64.CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER).toBe("/fake/llvm/bin/ld.lld");
    expect(aarch64.CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER).toBeUndefined();
  });

  test("linux follows the cross-language-LTO swap to rustc's gcc-ld/ld.lld", () => {
    // The release lanes link with rustc's bundled lld when rustc's LLVM is
    // newer than clang's (config.ts). rustc drives its own ld.lld wrapper
    // fine (unlike the lld-link one below), so the scanner links with it too.
    using dir = tempDir("vbs-rust-lld", { "gcc-ld/ld.lld": "", "gcc-ld/lld-link": "" });
    const rustLld = join(String(dir), "gcc-ld", "ld.lld");
    const cfg = linuxCi({}, mockToolchain({ rustLld, rustLlvmVersion: "22.1.4" }));
    expect(cfg.crossLangLto).toBe(true);
    expect(cfg.ld).toBe(rustLld);
    expect(verifyBaselineStaticInvocation(cfg).env.CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER).toBe(rustLld);
  });

  test("rustflags are always set, so the generated .cargo/config.toml's clang-driver link args never apply", () => {
    // cargo-config.ts writes `-Clink-arg=-fuse-ld=lld` for every triple into
    // the repo-root config, which cargo finds from the scanner's manifest
    // dir; lld invoked directly rejects it. CARGO_ENCODED_RUSTFLAGS replaces
    // config rustflags, so it has to be present even with nothing CI-specific
    // to say.
    expect(rustflagsOf(linuxCi({ ci: false }))).toEqual(["-Ctarget-feature=+crt-static"]);
  });

  test.skipIf(isWindows)("windows links like bun.exe does: static CRT against the UCRT overlay + xwin splat", () => {
    const cfg = windowsCi();
    const { env } = verifyBaselineStaticInvocation(cfg);
    expect(env.CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER).toBe("/fake/llvm/bin/lld-link");
    const ucrtOverlay = ucrtServicingLibDir(cfg)!;
    expect(ucrtOverlay).toContain("ucrt-servicing-");
    // The overlay's explicit /libpath: is searched before the directories
    // /winsysroot: derives (same ordering as linkFlags in flags.ts), and
    // /DEBUG:NONE has to come after the /DEBUG rustc itself passes, which
    // it does because rustc appends link args after its own.
    expect(rustflagsOf(cfg)).toEqual([
      "-Ctarget-feature=+crt-static",
      `-Clink-arg=/libpath:${ucrtOverlay}`,
      "-Clink-arg=/winsysroot:/fake/winsysroot",
      "-Clink-arg=/DEBUG:NONE",
      `--remap-path-prefix=${cfg.cwd}=.`,
    ]);
  });

  test.skipIf(isWindows)("windows keeps the host lld-link when cfg.ld was swapped to rustc's gcc-ld/lld-link", () => {
    // rustc prepends `-flavor link` to a linker inside its own gcc-ld/, which
    // that wrapper then passes on as an input file; config.ts exposes the
    // host lld-link as msvcLinker for cargo-driven links for exactly this
    // reason, and the scanner is one of those links.
    using dir = tempDir("vbs-rust-lld-link", { "gcc-ld/ld.lld": "", "gcc-ld/lld-link": "" });
    const cfg = windowsCi(
      {},
      mockToolchain({
        cc: "/fake/llvm/bin/clang-cl",
        cxx: "/fake/llvm/bin/clang-cl",
        ar: "/fake/llvm/bin/llvm-lib",
        ld: "/fake/llvm/bin/lld-link",
        rc: "/fake/llvm/bin/llvm-rc",
        rustLld: join(String(dir), "gcc-ld", "ld.lld"),
        rustLlvmVersion: "22.1.4",
      }),
    );
    expect(cfg.ld).toBe(join(String(dir), "gcc-ld", "lld-link"));
    expect(cfg.msvcLinker).toBe("/fake/llvm/bin/lld-link");
    expect(verifyBaselineStaticInvocation(cfg).env.CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER).toBe(
      "/fake/llvm/bin/lld-link",
    );
  });
});

describe("artifact contract with .buildkite/ci.mjs", () => {
  test("the uploaded name is the bare executable name getVerifyBaselineStep() downloads", () => {
    expect(verifyBaselineStaticArtifact(linuxCi())).toBe("verify-baseline-static");
    if (!isWindows) expect(verifyBaselineStaticArtifact(windowsCi())).toBe("verify-baseline-static.exe");
    // Test shards download every *.zip from build-bun; this must not be one.
    expect(verifyBaselineStaticArtifact(linuxCi())).not.toEndWith(".zip");
  });

  test("ci.mjs builds the scanner for, and downloads it in, the same set of targets", async () => {
    const ciMjs = await Bun.file(resolve(repoRoot, ".buildkite", "ci.mjs")).text();
    expect(ciMjs).toContain("--verify-baseline-static=on");
    for (const artifact of ["verify-baseline-static", "verify-baseline-static.exe"]) {
      expect(ciMjs).toContain(`"${artifact}"`);
    }
    // The step runs the downloaded binary; building one there is what this
    // artifact exists to avoid.
    expect(ciMjs).toContain("--static-checker");
    expect(ciMjs).not.toMatch(/cargo build/);
  });
});

describe("ninja edge", () => {
  const sources = globAllSources();

  test("the scanner's sources are globbed separately from the workspace's", () => {
    const rel = (paths: string[]) => paths.map(p => relative(repoRoot, p).replaceAll("\\", "/")).sort();
    expect(rel(sources.verifyBaselineStatic)).toEqual(
      expect.arrayContaining([
        "scripts/verify-baseline-static/Cargo.lock",
        "scripts/verify-baseline-static/Cargo.toml",
        "scripts/verify-baseline-static/src/main.rs",
      ]),
    );
    expect(sources.verifyBaselineStatic.every(p => p.startsWith(checkerDir))).toBe(true);
    // The source lints iterate `rust`; the scanner is not part of the port.
    expect(sources.rust.some(p => p.startsWith(checkerDir))).toBe(false);
  });

  /**
   * Emit the edge with cargo living in `binDir`. Returns the `build` line that
   * produces the scanner (continuations joined) plus the whole file, and a
   * spelling helper for paths as the build line carries them (buildDir-relative,
   * ninja-escaped, as Ninja.build() writes them).
   */
  function emit(binDir: string): { cfg: Config; edge: string; ninja: string; ninjaPath: (p: string) => string } {
    const cfg = linuxCi({ buildDir: join(binDir, "build") }, mockToolchain({ cargo: join(binDir, "cargo") }));
    const n = new Ninja({ buildDir: cfg.buildDir });
    registerDepRules(n, cfg);
    const exe = emitVerifyBaselineStatic(n, cfg, { verifyBaselineStatic: sources.verifyBaselineStatic } as Sources, [
      rustLibPath(cfg),
    ]);
    expect(exe).toBe(verifyBaselineStaticExe(cfg));
    const ninja = n.toString().replace(/ \$\n +/g, " ");
    const ninjaPath = (p: string) =>
      relative(cfg.buildDir, p).replace(/\$/g, "$$$$").replace(/ /g, "$ ").replace(/:/g, "$:");
    const edge = ninja.split("\n").find(line => line.startsWith(`build ${ninjaPath(exe)}:`));
    expect(edge).toBeDefined();
    return { cfg, edge: edge!, ninja, ninjaPath };
  }

  test("with rustup next to cargo, the edge installs the triple's rust-std before building", () => {
    // `rustup` is looked up next to cargo with the host's exe suffix
    // (findRustup in rust.ts); create both spellings so this holds on every host.
    using dir = tempDir("vbs-edge-rustup", { cargo: "", rustup: "", "rustup.exe": "" });
    const { cfg, edge, ninja, ninjaPath } = emit(String(dir));
    expect(edge).toContain(": dep_cargo_cross |");
    // `build <out>: <rule> | <implicit inputs> || <order-only inputs>`. The
    // implicit inputs are what re-invoke cargo: every scanner source, cargo
    // itself, and the toolchain pin. libbun_rust.a is order-only: the edge
    // waits for bun's own cargo step (shared rustup/cargo state) but a bun
    // rebuild does not rebuild the scanner.
    const [implicit, orderOnly] = edge.slice(edge.indexOf("|") + 1).split("||");
    expect(implicit!.trim().split(" ").sort()).toEqual(
      [...sources.verifyBaselineStatic, cfg.cargo!, resolve(cfg.cwd, "rust-toolchain.toml")].map(ninjaPath).sort(),
    );
    expect(orderOnly!.trim()).toBe(ninjaPath(rustLibPath(cfg)));
    expect(ninja).toContain("rust_target = x86_64-unknown-linux-musl");
    expect(ninja).toContain(`manifestdir = ${checkerDir}`);
    expect(ninja).toContain("CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=/fake/llvm/bin/ld.lld");
    expect(ninja).toContain(`build verify-baseline-static: phony ${ninjaPath(verifyBaselineStaticExe(cfg))}`);
  });

  test("without rustup, the plain cargo rule is used", () => {
    using dir = tempDir("vbs-edge-plain", { cargo: "" });
    expect(emit(String(dir)).edge).toContain(": dep_cargo |");
  });
});
