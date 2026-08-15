/**
 * `convert_utf16_to_utf8_in_buffer` (src/bun_core/lib.rs) narrows the UTF-16 the
 * Windows port gets from the OS (final paths of handles, `which` results, the
 * per-drive cwd environment values `node:path` reads, module names in the crash
 * handler) into caller-provided buffers. Such input may contain unpaired
 * surrogates. It used to check the buffer against simdutf's non-replacing length
 * scan (2 bytes per surrogate unit) and then call the valid-input-only
 * converter, which writes a lone surrogate plus the unit after it as 4 bytes,
 * one past an exactly sized buffer, and returns 0 (an empty path) for a lone
 * surrogate at the end. It now checks against the replacing length and
 * replaces, like every other UTF-16 to UTF-8 helper in bun_core.
 *
 * Every caller is Windows-only and hands it a buffer far larger than its input,
 * so the behavior is pinned by unit tests in bun_paths (src/paths/string_paths.rs,
 * the crate whose Windows path code is the main caller), which stub the two
 * simdutf entry points the new code path uses with scalar implementations.
 * Those test binaries reference simdutf symbols that only exist in the full bun
 * link, so they run through `cargo miri test` (what CI's `bun run rust:miri`
 * does for bun_paths, see scripts/rust-miri.ts), which also checks the raw
 * output-pointer writes of the stubbed converter against the buffer. This test
 * runs them and requires each one to have passed, so deleting them fails it too.
 * Skipped where miri is not installed or the cargo workspace is not resolvable
 * (test-only CI lanes run a prebuilt binary; same prerequisite check as
 * linear-fifo.test.ts).
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

const expectedResults = {
  "string_paths::tests::convert_utf16_to_utf8_in_buffer_exact_fit": "ok",
  "string_paths::tests::convert_utf16_to_utf8_in_buffer_replaces_unpaired_surrogates": "ok",
  "string_paths::tests::convert_utf16_to_utf8_in_buffer_charges_the_replacement_for_a_lone_surrogate": "ok",
};

test.skipIf(!miriAvailable)(
  "convert_utf16_to_utf8_in_buffer replaces unpaired surrogates and sizes its buffer check for them",
  async () => {
    await using proc = Bun.spawn({
      cmd: [cargoBin!, "miri", "test", "--locked", "-p", "bun_paths", "--", "convert_utf16_to_utf8_in_buffer"],
      cwd: repoRoot,
      env: { ...process.env, MIRIFLAGS: "-Zmiri-tree-borrows", CARGO_TERM_COLOR: "never" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      // Miri's diagnostic names the out-of-bounds write or foreign call it stopped at.
      console.error(stderr);
    }

    // libtest prints one line per test: `test <name>[ - should panic] ... ok`.
    const results: Record<string, string> = {};
    for (const [, name, status] of stdout.matchAll(/^test (\S+)(?: - should panic)? \.\.\. (\w+)$/gm)) {
      if (name in expectedResults) results[name] = status;
    }
    expect({ results, exitCode }).toEqual({ results: expectedResults, exitCode: 0 });
  },
  // Compiles bun_core for miri on the first run; the three tests themselves are instant.
  300_000,
);
