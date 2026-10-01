/**
 * `bun_core::strings::eql_long(a, b, false)` and `eql_comptime_ignore_len`
 * (src/bun_core/string/immutable.rs) compare `b.len()` bytes of `a`. The
 * length test that keeps that inside `a` used to be a `debug_assert!`, which
 * the shipped profile compiles out, so a caller passing a shorter `a` read
 * past it in release builds; both now return false for a shorter `a`.
 *
 * Every in-tree caller matches the lengths before calling, so there is no JS
 * input that reaches the over-read. The discriminator is the crate's own unit
 * tests (`mod tests` in immutable.rs, which pass a shorter exact-size
 * allocation to each helper) interpreted by Miri with debug assertions
 * compiled out, as in the shipped profile: with a debug-only check the
 * over-read is reported as undefined behavior, with the real check the tests
 * pass. bun_core is not in `bun run rust:miri`'s crate set (its other tests
 * call into libc and simdutf, which Miri cannot interpret), so the relevant
 * tests are run by name here. Skipped where miri is not installed or the
 * cargo workspace is not resolvable (test-only lanes run a prebuilt binary
 * and lack vendor/lolhtml), the same prerequisites as linear-fifo.test.ts.
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

const unitTests = [
  "string::immutable::tests::eql_long_rejects_a_shorter_a_str_in_both_modes",
  "string::immutable::tests::eql_long_without_check_len_compares_a_prefix_of_a_str",
  "string::immutable::tests::eql_comptime_ignore_len_rejects_a_shorter_input",
];

test.skipIf(!miriAvailable)(
  "eql_long and eql_comptime_ignore_len stay in bounds for a shorter input with debug assertions compiled out",
  async () => {
    await using proc = Bun.spawn({
      cmd: [cargoBin!, "miri", "test", "--locked", "--lib", "-p", "bun_core", "--", ...unitTests],
      cwd: repoRoot,
      env: {
        ...process.env,
        // Same aliasing model as `bun run rust:miri` (scripts/rust-miri.ts).
        MIRIFLAGS: "-Zmiri-tree-borrows",
        // The `test` profile inherits `dev`, which has debug assertions on; a
        // precondition that is only debug_assert!ed would fail the unit test
        // as a panic instead of as the release-build over-read under test.
        CARGO_PROFILE_TEST_DEBUG_ASSERTIONS: "false",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      // Surface miri's diagnostic so the failing read shows up in the log.
      console.error(stderr || stdout);
    }
    expect(stderr).not.toContain("Undefined Behavior");
    // Each test has to have run and passed: a renamed or stashed test filters
    // down to "running 0 tests", which also exits 0.
    expect(unitTests.filter(name => stdout.includes(`test ${name} ... ok`))).toEqual(unitTests);
    expect(exitCode).toBe(0);
  },
  180_000,
);
