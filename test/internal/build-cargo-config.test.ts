/**
 * generateCargoConfig() (scripts/build/cargo-config.ts) writes the git-ignored
 * repo-root .cargo/config.toml. The ninja build overrides everything in it via
 * env; it exists for cargo invoked directly (`cargo check`, `cargo test -p
 * <crate>`, rust-analyzer).
 *
 * The first test exercises the generator against a fake toolchain and runs on
 * every host. The second links a real test binary through the repo's generated
 * config and only runs where that is possible: a Windows host with a configured
 * tree (the config file, build_options.rs and vendor/lolhtml all come from
 * configure, which `bun bd` runs first; test-only CI lanes have none of them).
 */
import { which } from "bun";
import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { generateCargoConfig } from "../../scripts/build/cargo-config.ts";
import { resolveConfig, type Toolchain } from "../../scripts/build/config.ts";
import { allRustTargets } from "../../scripts/build/rust.ts";

/**
 * A fully-populated fake toolchain. resolveConfig only records these paths; the
 * one probe it runs (`cc --version` for the arch, Windows hosts only) fails on
 * the fake path and falls back to the host arch.
 */
const mockToolchain: Toolchain = {
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
};

interface TargetEntry {
  linker?: string;
  rustflags?: string[];
}

/** Generate into a scratch "repo root" and return the parsed `[target.*]` tables. */
function generatedTargets(): Record<string, TargetEntry> {
  using dir = tempDir("build-cargo-config", {});
  const cwd = String(dir);
  const cfg = { ...resolveConfig({ buildDir: join(cwd, "build") }, mockToolchain), cwd };

  const path = generateCargoConfig(cfg);
  expect(path).toBe(join(cwd, ".cargo", "config.toml"));

  const parsed = Bun.TOML.parse(readFileSync(path, "utf8")) as { target: Record<string, TargetEntry> };
  return parsed.target;
}

test("every CI rust target gets an entry; msvc triples get /FORCE:UNRESOLVED instead of a linker", () => {
  const targets = generatedTargets();

  // Without this, `cargo test -p <any bun_core dependent>` fails to link on a
  // Windows host with ~80 LNK2019s (see the comment in cargo-config.ts).
  const msvc = { rustflags: ["-C", "link-arg=/FORCE:UNRESOLVED"] };

  expect(Object.keys(targets).sort()).toEqual([...allRustTargets].sort());
  expect(targets).toEqual({
    ...Object.fromEntries(
      allRustTargets
        .filter(triple => !triple.includes("windows"))
        .map(triple => [
          triple,
          {
            // The discovered host clang++ for the host OS's triples, PATH-resolved
            // `clang++` for the others.
            linker: expect.stringMatching(/clang\+\+$/),
            rustflags: ["-C", "link-arg=-fuse-ld=lld", "-C", "link-arg=-Qunused-arguments", "-A", "linker_messages"],
          },
        ]),
    ),
    // No `linker =`: the MSVC linker is not a clang driver. rustc locates
    // link.exe itself; the ninja build pins it through CARGO_TARGET_*_LINKER.
    "x86_64-pc-windows-msvc": msvc,
    "aarch64-pc-windows-msvc": msvc,
  });
});

const cargo = which("cargo");
const repoRoot = join(import.meta.dir, "..", "..");
// Same prerequisite check as rust-windows-sys-link.test.ts / scripts/rust-miri.ts.
const workspaceResolvable =
  existsSync(join(repoRoot, "vendor", "lolhtml", "Cargo.toml")) &&
  existsSync(join(repoRoot, "build", "debug", "codegen", "build_options.rs"));

// bun_paths is the crate this was reported against: it depends on bun_core and
// stubs only the two simdutf externs its tests execute (src/paths/string_paths.rs),
// so without the generated rustflags link.exe reports the ~80 externs nothing
// executes.
//
// The environment can override the file: RUSTFLAGS / CARGO_ENCODED_RUSTFLAGS
// replace every rustflags source and CARGO_TARGET_<TRIPLE>_RUSTFLAGS replaces
// that triple's [target.*] table. All of them are dropped (case-insensitively:
// Windows environment names are) so the file is what is under test.
const overridesCargoConfig = /^(RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|CARGO_TARGET_.*_RUSTFLAGS)$/i;

// `--no-run`: the link is the bug. Cold, this compiles bun_core and its
// dependencies (~40 crates), hence the explicit ceiling; warm, it relinks in
// about a second.
test.skipIf(!isWindows || !cargo || !workspaceResolvable)(
  "cargo test -p bun_paths links on a Windows host through the generated .cargo/config.toml",
  async () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !overridesCargoConfig.test(name)));
    await using proc = Bun.spawn({
      cmd: [cargo!, "test", "--locked", "-p", "bun_paths", "--lib", "--no-run", "--quiet"],
      cwd: repoRoot,
      env: { ...env, CARGO_TERM_COLOR: "never" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("unresolved external symbol");
    expect(stderr).not.toContain("undefined symbol:");
    // link.exe still lists the externs it resolved to 0 (and warns LNK4088);
    // rustc only relays that through the linker_messages lint, which the
    // workspace lints allow, so a successful link is also a quiet one.
    expect(stderr).not.toContain("linker stdout");
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
  },
  600_000,
);
