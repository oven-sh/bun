/**
 * `simdutf::base64::encode` (src/simdutf_sys/simdutf.rs) hands C++ the output
 * slice as a bare pointer; simdutf then writes the whole encoding without ever
 * seeing the slice length. The length check in that wrapper is all that keeps a
 * short buffer passed by safe code (`bun_base64::encode` / `encode_url_safe`,
 * a few dozen callers) from becoming a heap overflow. No JS API reaches the
 * encoder with a short buffer, so the contract is pinned by `#[should_panic]`
 * unit tests in bun_simdutf_sys and bun_base64.
 *
 * Those test binaries reference simdutf symbols that only exist in the full bun
 * link, so plain `cargo test` cannot link them; `cargo miri test` (what CI's
 * `bun run rust:miri` runs, see scripts/rust-miri.ts) interprets them instead.
 * With the check in place the wrapper panics before the foreign call; without
 * it, Miri stops the test at the `simdutf__base64_encode` call the short buffer
 * was about to be handed to. This test runs those unit tests and requires each
 * one to have passed, so deleting them fails it too. Skipped where miri is not
 * installed or the cargo workspace is not resolvable (test-only CI lanes run a
 * prebuilt binary; same prerequisite check as linear-fifo.test.ts).
 */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";

const cargoBin = Bun.which("cargo");
const repoRoot = path.resolve(import.meta.dir, "..", "..");
const workspaceResolvable =
  existsSync(path.join(repoRoot, "vendor", "lolhtml", "Cargo.toml")) &&
  existsSync(path.join(repoRoot, "build", "debug", "codegen", "build_options.rs"));
const miriAvailable =
  !!cargoBin &&
  workspaceResolvable &&
  Bun.spawnSync({
    cmd: [cargoBin, "miri", "--version"],
    cwd: repoRoot,
    stdout: "ignore",
    stderr: "ignore",
    timeout: 30_000,
  }).exitCode === 0;

// Each short-buffer test is one byte short for its alphabet (one input byte
// encodes to 4 bytes padded, 2 bytes URL-safe) and asserts on the panic
// message, so it also fails if the check computes the wrong alphabet's length.
const expectedResults = {
  // bun_simdutf_sys: the wrapper that performs the unchecked write.
  "simdutf::base64::tests::encode_len_pads_the_standard_alphabet_only": "ok",
  "simdutf::base64::tests::encode_panics_when_the_padded_output_does_not_fit": "ok",
  "simdutf::base64::tests::encode_panics_when_the_url_safe_output_does_not_fit": "ok",
  // bun_base64: the safe entry points the rest of the codebase calls.
  "tests::encode_panics_when_the_destination_is_too_short": "ok",
  "tests::encode_url_safe_panics_when_the_destination_is_too_short": "ok",
};

test.skipIf(!miriAvailable)(
  "base64 encoders panic on a too-short output buffer instead of handing it to simdutf",
  async () => {
    await using proc = Bun.spawn({
      cmd: [cargoBin!, "miri", "test", "--locked", "-p", "bun_simdutf_sys", "-p", "bun_base64"],
      cwd: repoRoot,
      env: { ...process.env, MIRIFLAGS: "-Zmiri-tree-borrows", CARGO_TERM_COLOR: "never" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      // Miri's diagnostic names the foreign call that was reached.
      console.error(stderr);
    }

    // libtest prints one line per test: `test <name>[ - should panic] ... ok`.
    const results: Record<string, string> = {};
    for (const [, name, status] of stdout.matchAll(/^test (\S+)(?: - should panic)? \.\.\. (\w+)$/gm)) {
      if (name in expectedResults) results[name] = status;
    }
    expect({ results, exitCode }).toEqual({ results: expectedResults, exitCode: 0 });
  },
  180_000,
);
