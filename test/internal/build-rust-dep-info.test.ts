/**
 * The cargo edge in scripts/build/rust.ts must consume cargo's dep-info file
 * as its ninja depfile.
 *
 * The edge's manifest-declared inputs are the configure-time glob of `*.rs`
 * files and Cargo manifests (glob-sources.ts). Files those sources embed with
 * `include_bytes!` / `include_str!` (completions/bun.{bash,zsh,fish}, the
 * `bun init` / `bun create` templates, the dev error page, ...) are not in
 * that glob, so without the depfile an edit to one of them leaves ninja with
 * "no work to do" and `bun bd` hands back a binary with the previous embed.
 * Cargo lists every file it read, assets included, in `<staticlib stem>.d`
 * next to the staticlib; `deps = gcc` makes ninja fold that list into the
 * edge's inputs after each run.
 *
 * These exercise the ninja emission only (no cargo or ninja is run), so they
 * run on every host. On Windows, emitting the edge also pre-creates the
 * git-ignored 0-byte shim placeholder in the source tree, as `bun bd` does.
 */
import { describe, expect, test } from "bun:test";
import { isMacOS, isWindows, tempDir } from "harness";
import { join, relative } from "node:path";

import { resolveConfig, type Config, type Toolchain } from "../../scripts/build/config.ts";
import { Ninja } from "../../scripts/build/ninja.ts";
import { emitRust, registerRustRules, rustDepInfoPath, rustLibPath, rustTarget } from "../../scripts/build/rust.ts";

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
    // No rustup next to it, so emitRust() picks the plain `rust_build` rule.
    cargo: "/fake/cargo/bin/cargo",
    cargoHome: undefined,
    rustupHome: undefined,
    msvcLinker: undefined,
    rc: undefined,
    mt: undefined,
    nasm: undefined,
    ...overrides,
  };
}

const slash = (p: string) => p.replaceAll("\\", "/");

/** Host-targeted debug config (what `bun bd` resolves), writing into `buildDir`. */
function hostConfig(buildDir: string, toolchain = mockToolchain()): Config {
  return resolveConfig({ buildDir, buildType: "Debug" }, toolchain);
}

/** Register the rust rules and emit the cargo edge for `cfg`; returns the ninja text. */
function emit(cfg: Config): string {
  const n = new Ninja({ buildDir: cfg.buildDir });
  registerRustRules(n, cfg);
  emitRust(n, cfg, {
    codegenInputs: [join(cfg.codegenDir, "generated_classes.h")],
    codegenOrderOnly: [],
    rustSources: [join(cfg.cwd, "src", "bun_bin", "lib.rs"), join(cfg.cwd, "Cargo.toml")],
    vendorStamps: [join(cfg.vendorDir, "lolhtml", ".ref")],
  });
  return n.toString();
}

/** Unwrap `$\n` continuations so each rule / build statement is one line plus its bindings. */
const ninjaLines = (ninja: string) => ninja.replace(/ \$\n +/g, " ").split("\n");

/** `build <output>: <rule> ...` -> `{ rule, bindings }` of the edge producing `output` (buildDir-relative, `/`-separated). */
function edge(ninja: string, output: string): { rule: string; bindings: Record<string, string> } {
  const lines = ninjaLines(ninja);
  const start = lines.findIndex(l => slash(l).startsWith(`build ${output}:`));
  if (start === -1) throw new Error(`no edge producing ${output} in:\n${ninja}`);
  const rule = lines[start]!.slice(lines[start]!.indexOf(": ") + 2).split(" ")[0]!;
  return { rule, bindings: bindingsAfter(lines, start) };
}

/** The bindings of `rule <name>`. */
function rule(ninja: string, name: string): Record<string, string> {
  const lines = ninjaLines(ninja);
  const start = lines.indexOf(`rule ${name}`);
  if (start === -1) throw new Error(`no rule ${name} in:\n${ninja}`);
  return bindingsAfter(lines, start);
}

/** The indented `key = value` lines following `start`, up to the blank line ninja.ts emits after every block. */
function bindingsAfter(lines: string[], start: number): Record<string, string> {
  const bindings: Record<string, string> = {};
  for (let i = start + 1; i < lines.length && lines[i] !== ""; i++) {
    const m = /^ {2}(\w+) = (.*)$/.exec(lines[i]!);
    if (m !== null) bindings[m[1]!] = m[2]!;
  }
  return bindings;
}

/**
 * The two paths the edge must agree on for `cfg`: the declared output is
 * cargo's staticlib, and the depfile is the dep-info cargo writes next to it
 * under the same stem (libbun_rust.a -> libbun_rust.d, bun_rust.lib ->
 * bun_rust.d), both buildDir-relative like every other path in build.ninja.
 */
function expectedPaths(cfg: Config): { output: string; depInfo: string } {
  const profileDir = `rust-target/${rustTarget(cfg)}/${cfg.buildType === "Debug" ? "debug" : "release"}`;
  return {
    output: `${profileDir}/${cfg.libPrefix}bun_rust${cfg.libSuffix}`,
    depInfo: `${profileDir}/${cfg.libPrefix}bun_rust.d`,
  };
}

function expectDepInfoWired(ninja: string, cfg: Config, ruleName: "rust_build" | "rust_build_cross"): void {
  const { output, depInfo } = expectedPaths(cfg);
  const staticlib = edge(ninja, output);
  expect(staticlib.rule).toBe(ruleName);
  // `deps = gcc`: ninja reads the file right after cargo exits and stores the
  // list in .ninja_deps, so the (absolute) target name cargo writes inside
  // it is never compared against the relative output. restat stays: a no-op
  // cargo run must still prune the link.
  expect(rule(ninja, ruleName)).toMatchObject({ depfile: "$dep_info", deps: "gcc", restat: "1" });
  expect(slash(staticlib.bindings.dep_info ?? "")).toBe(depInfo);
}

describe("cargo edge depfile", () => {
  test("rust_build reads cargo's dep-info as its depfile", () => {
    using dir = tempDir("build-rust-dep-info", {});
    const cfg = hostConfig(String(dir));
    expectDepInfoWired(emit(cfg), cfg, "rust_build");
  });

  test("rust_build_cross (rustup-managed cargo, pinned channel) does too", () => {
    // findRustup() selects the cross rule when `rustup<exeSuffix>` sits next
    // to cargo; the channel comes from the repo's rust-toolchain.toml.
    const exe = isWindows ? ".exe" : "";
    using dir = tempDir("build-rust-dep-info", {
      [`toolchain/bin/cargo${exe}`]: "",
      [`toolchain/bin/rustup${exe}`]: "",
    });
    const cargo = join(String(dir), "toolchain", "bin", `cargo${exe}`);
    const cfg = hostConfig(join(String(dir), "build"), mockToolchain({ cargo }));
    expect(cfg.rustToolchain).toBeDefined();
    expectDepInfoWired(emit(cfg), cfg, "rust_build_cross");
  });

  test("the dep-info path follows the staticlib's name on each target", () => {
    using dir = tempDir("build-rust-dep-info", {});
    const buildDir = String(dir);
    const paths = (cfg: Config) => ({
      output: slash(relative(buildDir, rustLibPath(cfg))),
      depInfo: slash(relative(buildDir, rustDepInfoPath(cfg))),
    });

    const host = hostConfig(buildDir);
    expect(paths(host)).toEqual(expectedPaths(host));

    // Cross config on non-windows hosts; any sysroot string satisfies
    // resolveConfig (nothing is probed). Native on windows, where the host
    // case above already covers it.
    const windows = resolveConfig(
      { buildDir, os: "windows", arch: "x64", buildType: "Release", winsysroot: join(buildDir, "winsysroot") },
      mockToolchain(),
    );
    expect(paths(windows)).toEqual({
      output: "rust-target/x86_64-pc-windows-msvc/release/bun_rust.lib",
      depInfo: "rust-target/x86_64-pc-windows-msvc/release/bun_rust.d",
    });

    // On macOS the host case is this config; as a cross config elsewhere it
    // resolves without an SDK (see macos-cross-config.test.ts).
    if (!isMacOS) {
      const darwin = resolveConfig({ buildDir, os: "darwin", arch: "aarch64", buildType: "Release" }, mockToolchain());
      expect(paths(darwin)).toEqual({
        output: "rust-target/aarch64-apple-darwin/release/libbun_rust.a",
        depInfo: "rust-target/aarch64-apple-darwin/release/libbun_rust.d",
      });
    }
  });
});
