/**
 * Coverage for `DynamicBitSet::copy_into` (src/collections/bit_set.rs) with
 * sets of different lengths.
 *
 * `DynamicBitSet` is an internal Rust collection with no JS-visible surface.
 * The one in-tree caller that copies between sets of different lengths is
 * `PackageInstaller::fix_cached_lockfile_package_slices`, which grows
 * `successfully_installed` when `lockfile.packages` grows during an install.
 * That branch cannot be reached deterministically from the CLI, so the
 * `bitSetCopyIntoProbe` helper (src/runtime/bit_set_testing.rs, exposed via
 * `bun:internal-for-testing`) drives the copy directly: it builds a source set
 * with the given bits, a destination set with every bit set, copies the source
 * into the destination and returns the indices still set in the destination.
 *
 * `copy_into` used to loop over the destination's mask words and read the
 * source word at the same index, so a 64-bit source copied into a 65-bit
 * destination read one word past the source's allocation. Under ASAN that is a
 * heap-buffer-overflow abort; in a release build the stray word leaked into
 * the destination. The crate's own `#[cfg(test)] mod tests` exercise the same
 * shapes under Miri as well.
 */
import { bitSetCopyIntoProbe } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";

describe("DynamicBitSet::copy_into", () => {
  test("a one-word source into a two-word destination (64 -> 65 bits)", () => {
    expect(bitSetCopyIntoProbe(64, 65, [0, 17, 63])).toEqual([0, 17, 63]);
  });

  test("an empty source clears a longer destination", () => {
    expect(bitSetCopyIntoProbe(0, 130, [])).toEqual([]);
  });

  test("the destination bits past the source length are cleared", () => {
    // 100 -> 200 bits: the source covers two words, the destination four.
    expect(bitSetCopyIntoProbe(100, 200, [1, 64, 99])).toEqual([1, 64, 99]);
  });

  test("source bits past the destination length are dropped", () => {
    expect(bitSetCopyIntoProbe(70, 66, [3, 64, 65, 69])).toEqual([3, 64, 65]);
  });

  test("equal lengths copy every word", () => {
    expect(bitSetCopyIntoProbe(130, 130, [0, 63, 64, 127, 128, 129])).toEqual([0, 63, 64, 127, 128, 129]);
  });
});

// Skipped where miri is not installed, or where the cargo workspace is not
// resolvable (test-only lanes run a prebuilt binary and lack the vendored path
// deps; see scripts/rust-miri.ts for the same prerequisite check).
const cargoBin = Bun.which("cargo");
const repoRoot = path.resolve(import.meta.dir, "..", "..");
const workspaceResolvable =
  existsSync(path.join(repoRoot, "vendor", "lolhtml", "Cargo.toml")) &&
  existsSync(path.join(repoRoot, "vendor", "rust-argon2", "Cargo.toml")) &&
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

test.skipIf(!miriAvailable)(
  "bit_set unit tests are clean under miri",
  async () => {
    await using proc = Bun.spawn({
      cmd: [cargoBin!, "miri", "test", "--locked", "-p", "bun_collections", "--", "bit_set::tests"],
      cwd: repoRoot,
      env: { ...process.env, MIRIFLAGS: "-Zmiri-tree-borrows" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      console.error(stderr || stdout);
    }
    expect(stderr).not.toContain("Undefined Behavior");
    expect(exitCode).toBe(0);
  },
  120_000,
);
