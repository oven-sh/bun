// scripts/rust-test.ts runs `cargo test -p <crate>` natively for the crates
// listed there. A crate's test binary links only its Rust dependencies, so a
// test reaching one of the externs that exist solely in the full bun link
// (bun_clap's streaming tests reach the highway byte-search kernels through
// bun_core::strings, which is what bun_highway's `scalar` feature in
// src/clap/Cargo.toml is for) fails with
//   ld.lld: error: undefined symbol: highway_index_of_char
// The `cargo test` job in .github/workflows/rust-lints.yml runs the same
// script in CI; this is the local and debug-build counterpart, so that a
// broken crate shows up in `bun bd test` as well.
//
// Needs cargo and a configured checkout (cargo cannot resolve the workspace
// without vendor/lolhtml, and bun_core/build.rs needs build_options.rs); the
// test-only CI lanes have neither and skip. Skipped on Windows too: link.exe
// also rejects references from code the tests never run, so every bun_core
// dependent's test binary fails to link there regardless of what this script
// checks (#37575 covers that side). Cold, the script first compiles bun_core
// and the other shared dependencies, hence the explicit ceiling.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";
import { cargoWorkspaceConfigured, repo } from "../../scripts/rust-workspace.ts";

test.skipIf(isWindows || !Bun.which("cargo") || !cargoWorkspaceConfigured())(
  "the crates in scripts/rust-test.ts link and pass under a native cargo test",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(repo, "scripts", "rust-test.ts")],
      cwd: repo,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("undefined symbol");
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
  },
  600_000,
);
