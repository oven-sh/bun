/**
 * The workspace relies on the polonius borrow checker (-Zpolonius=next), so
 * every rustc invocation that type-checks workspace crates has to carry the
 * flag: the ninja cargo edge (rust.ts, via CARGO_ENCODED_RUSTFLAGS) and the
 * generated .cargo/config.toml (cargo-config.ts) used by plain cargo,
 * rust:check-all and rust-analyzer. Configure-time logic only; nothing here
 * spawns a compiler.
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { generateCargoConfig } from "../../scripts/build/cargo-config.ts";
import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { allRustTargets, cargoBuildInvocation } from "../../scripts/build/rust.ts";

/** A fully-populated fake toolchain; resolveConfig never spawns any of these. */
function mockToolchain(): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang",
    cxx: "/fake/llvm/bin/clang++",
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
    cargo: "/fake/bin/cargo",
    cargoHome: undefined,
    rustupHome: undefined,
    msvcLinker: "/fake/msvc/lld-link",
    rc: undefined,
    mt: undefined,
    nasm: undefined,
  };
}

const configs: Record<string, PartialConfig> = {
  "linux x64 debug": {
    os: "linux",
    arch: "x64",
    abi: "gnu",
    buildType: "Debug",
    assertions: true,
    linuxSysroot: "/fake",
  },
  "linux aarch64 release (ci)": {
    os: "linux",
    arch: "aarch64",
    abi: "gnu",
    buildType: "Release",
    ci: true,
    buildkite: false,
    linuxSysroot: "/fake",
  },
  "linux x64 release-asan": {
    os: "linux",
    arch: "x64",
    abi: "gnu",
    buildType: "Release",
    asan: true,
    linuxSysroot: "/fake",
  },
  "windows x64 release (ci)": {
    os: "windows",
    arch: "x64",
    buildType: "Release",
    ci: true,
    buildkite: false,
    winsysroot: "/fake/winsysroot",
  },
  "darwin aarch64 release": { os: "darwin", arch: "aarch64", buildType: "Release" },
};

function resolve(partial: PartialConfig): Config {
  return resolveConfig(partial, mockToolchain());
}

/** Decode the U+001F-separated CARGO_ENCODED_RUSTFLAGS the ninja edge sets. */
function encodedRustflags(cfg: Config): string[] {
  const encoded = cargoBuildInvocation(cfg).env.CARGO_ENCODED_RUSTFLAGS;
  expect(encoded).toBeString();
  return encoded.split("\x1f");
}

describe("-Zpolonius=next reaches every rustc invocation", () => {
  test.each(Object.entries(configs))("ninja cargo edge: %s", (_name, partial) => {
    expect(encodedRustflags(resolve(partial))).toContain("-Zpolonius=next");
  });

  test("generated .cargo/config.toml carries the flag for every target triple", () => {
    using dir = tempDir("polonius-cargo-config", {});
    const cfg: Config = { ...resolve(configs["linux x64 debug"]), cwd: String(dir) };

    const written = generateCargoConfig(cfg);
    expect(written).toBe(join(String(dir), ".cargo", "config.toml"));
    const toml = readFileSync(written, "utf8");

    // Parse the file into { [triple]: rustflags line } so every triple is
    // checked individually, including the rustflags-only windows sections.
    const sections = new Map<string, string>();
    for (const block of toml.split(/\n(?=\[target\.)/)) {
      const header = /^\[target\.([^\]\s]+)\]/.exec(block);
      if (!header) continue;
      const rustflags = /^rustflags = (.+)$/m.exec(block);
      sections.set(header[1], rustflags ? rustflags[1] : "");
    }

    expect([...sections.keys()].sort()).toEqual([...allRustTargets].sort());
    for (const triple of allRustTargets) {
      const flags: string[] = JSON.parse(sections.get(triple)!);
      const joined = flags.join(" ");
      expect(joined).toContain("-Z polonius=next");

      const isWindowsTriple = triple.includes("windows");
      // Non-windows triples keep the lld link flags; windows triples are
      // linked via env in rust.ts and must not grow a clang-style link-arg.
      expect(joined.includes("link-arg=-fuse-ld=lld")).toBe(!isWindowsTriple);
      expect(toml).toMatch(
        new RegExp(
          `^\\[target\\.${triple.replaceAll(".", "\\.")}\\][^\\n]*\\n${isWindowsTriple ? "rustflags" : "linker"} = `,
          "m",
        ),
      );
    }
  });

  test("the two flag sources agree", () => {
    // rust.ts pushes the single-token spelling; cargo-config.ts writes the
    // two-token TOML array form. rustc accepts both; this pins that neither
    // side is dropped independently of the other.
    using dir = tempDir("polonius-cargo-config-agree", {});
    const cfg: Config = { ...resolve(configs["windows x64 release (ci)"]), cwd: String(dir) };
    const toml = readFileSync(generateCargoConfig(cfg), "utf8");
    expect(toml).toContain(`"-Z", "polonius=next"`);
    expect(encodedRustflags(cfg)).toContain("-Zpolonius=next");
  });
});
