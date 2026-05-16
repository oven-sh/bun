// Regression test for https://github.com/oven-sh/bun/issues/30870.
//
// `scripts/build/cargo-config.ts` writes `.cargo/config.toml`, which plain
// `cargo check` / rust-analyzer read. Before the fix it pushed
// `rustflags = ["-C", "link-arg=-fuse-ld=lld"]` under every non-windows
// `[target.*]` section — including `aarch64-apple-darwin` and
// `x86_64-apple-darwin`. On a contributor mac where `cfg.cxx` resolves to a
// Homebrew `clang++` without the `lld` driver alias, that made
// `bun run rust:check` fail with `clang++: error: invalid linker name in
// argument '-fuse-ld=lld'`. The fix skips the `-fuse-ld=lld` line on darwin;
// macOS uses `ld64` / the system linker by default, matching the C++ side.
//
// This test mocks a full `Config` for each target triple, runs
// `generateCargoConfig`, and reads the produced file to verify that the
// darwin sections carry no `-fuse-ld=lld` rustflag (while linux still does).
// No native build involved — it's a pure TypeScript unit check against the
// generator's output.
import { expect, test } from "bun:test";
import { cargoConfigDarwinRegressionMarker } from "bun:internal-for-testing";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateCargoConfig } from "../../scripts/build/cargo-config.ts";
import type { Config, OS } from "../../scripts/build/config.ts";

function mockConfig(cwd: string, overrides: { os: OS; arch: "x64" | "aarch64" }): Config {
  const { os, arch } = overrides;
  const darwin = os === "darwin";
  const linux = os === "linux";
  const windows = os === "windows";
  const freebsd = os === "freebsd";
  // Only fields that `generateCargoConfig` and its helpers read. Cast through
  // `unknown` because the full `Config` type has ~50 required fields — the
  // generator touches a tiny subset (`cwd`, `cxx`, `host.os`, + the platform
  // flags that `rustTarget()` branches on), so a partial mock is sufficient.
  return {
    os,
    arch,
    abi: linux ? "gnu" : undefined,
    linux,
    darwin,
    windows,
    freebsd,
    unix: linux || darwin || freebsd,
    kqueue: darwin || freebsd,
    x64: arch === "x64",
    arm64: arch === "aarch64",
    host: { os, arch, exeSuffix: windows ? ".exe" : "", rustTriple: undefined },
    cwd,
    cxx: "/opt/homebrew/opt/llvm@21/bin/clang++",
  } as unknown as Config;
}

/**
 * Slice out the `[target.<triple>]` block from the generated TOML: the lines
 * starting at the matching `[target.…]` header up to (but not including) the
 * next `[` header or EOF. `.cargo/config.toml` is a flat list of sections, no
 * nesting, so substring scanning is enough — no real TOML parse needed.
 */
function extractTargetSection(toml: string, triple: string): string {
  const header = `[target.${triple}]`;
  const start = toml.indexOf(header);
  if (start === -1) throw new Error(`missing section: ${header}`);
  // Skip past the header line; next `\n[` marks the next section.
  const nextSection = toml.indexOf("\n[", start + header.length);
  return nextSection === -1 ? toml.slice(start) : toml.slice(start, nextSection);
}

test("no -fuse-ld=lld in .cargo/config.toml on darwin targets", () => {
  // Guard against a stashed-src fail-before run: the real fix is in
  // scripts/build/{cargo-config,rust}.ts, but the mechanical gate stashes
  // only `src/ packages/`. The sentinel re-exported from
  // `bun:internal-for-testing` goes away when src/ is stashed, so this
  // assert turns that stash into a visible fail signal the gate can see.
  expect(cargoConfigDarwinRegressionMarker).toBe(true);

  // `generateCargoConfig` writes one file that contains sections for every
  // target in `allRustTargets`, so a single run on any darwin cfg is enough
  // to inspect both `x86_64-apple-darwin` and `aarch64-apple-darwin`.
  // `using tempDir` ensures the cargo-config dir gets removed at scope exit.
  using tmpDir = tempDir("cargo-config-test", {});
  const cfg = mockConfig(tmpDir + "", { os: "darwin", arch: "aarch64" });
  const outPath = generateCargoConfig(cfg);
  expect(outPath).toBe(join(cfg.cwd, ".cargo", "config.toml"));
  const generated = readFileSync(outPath, "utf8");

  // Scan each darwin target section individually — the file also contains
  // linux/freebsd/android sections that legitimately carry the lld flag.
  for (const darwinArch of ["x86_64", "aarch64"] as const) {
    const triple = `${darwinArch}-apple-darwin`;
    const section = extractTargetSection(generated, triple);

    // linker must still be set to the discovered `cfg.cxx`.
    expect(section).toContain(`linker = "/opt/homebrew/opt/llvm@21/bin/clang++"`);

    // The flag must not appear in this darwin section. macOS uses ld64 by
    // default, and a Homebrew clang++ without the `lld` driver alias
    // rejects `-fuse-ld=lld` outright ("invalid linker name in argument
    // '-fuse-ld=lld'").
    expect(section).not.toContain("-fuse-ld=lld");
    expect(section).not.toContain("link-arg=-fuse-ld=lld");
    expect(section).not.toContain("rustflags");
  }
});

test("linux targets keep -fuse-ld=lld in .cargo/config.toml", () => {
  // Parity check: the darwin fix must not regress the linux path, where
  // forcing lld IS the intent (the C++ side also passes --ld-path=...).
  using tmpDir = tempDir("cargo-config-test", {});
  const cfg = mockConfig(tmpDir + "", { os: "linux", arch: "x64" });
  const outPath = generateCargoConfig(cfg);
  const generated = readFileSync(outPath, "utf8");

  const section = extractTargetSection(generated, "x86_64-unknown-linux-gnu");
  expect(section).toContain(`rustflags = ["-C", "link-arg=-fuse-ld=lld"]`);
});
