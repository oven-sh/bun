/**
 * `JSValue::from_entries` (src/jsc/JSValue.rs) is a safe fn that hands
 * `JSC__JSValue__fromEntries` the two `ZigString` slices as bare pointers plus
 * a single count, `keys.len()`, and C++ reads that many entries from BOTH
 * arrays. The length check in the wrapper is all that keeps a shorter `values`
 * slice from being read past its end. It used to be a `debug_assert`, which
 * release builds compile out. The only caller (`FileSystemRouter#routes`)
 * fills both halves of one Vec, so no JS API reaches the mismatch; the
 * contract is pinned by `#[should_panic]` unit tests next to the function.
 *
 * Those unit tests are run with debug assertions disabled
 * (`CARGO_PROFILE_TEST_DEBUG_ASSERTIONS=false`), i.e. in the configuration
 * shipped builds use, where only a release-mode check can make them pass.
 * bun_jsc's test binary references C++ symbols that only exist in the full bun
 * link, so plain `cargo test` cannot link it; `cargo miri test` interprets it
 * instead, and without the check it stops each test at the foreign call the
 * mismatched slices were about to be passed to. This test requires both unit
 * tests to have run and passed, so deleting them fails it too.
 *
 * bun_jsc is not in scripts/rust-miri.ts's crate list: its build script needs
 * the codegen output of a `bun bd`, which that lane does not produce, and the
 * default profile there has debug assertions on, which is not the
 * configuration this contract is about. Skipped where miri is not installed or
 * the cargo workspace is not resolvable (test-only CI lanes run a prebuilt
 * binary; same prerequisite check as linear-fifo.test.ts).
 */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";

const cargoBin = Bun.which("cargo");
const repoRoot = path.resolve(import.meta.dir, "..", "..");
const codegenDir = path.join(repoRoot, "build", "debug", "codegen");
const workspaceResolvable =
  existsSync(path.join(repoRoot, "vendor", "lolhtml", "Cargo.toml")) &&
  existsSync(path.join(codegenDir, "build_options.rs")) &&
  // src/jsc/build.rs additionally include!()s this.
  existsSync(path.join(codegenDir, "cpp.rs"));
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

// One test per direction of the mismatch, each asserting on the panic message
// with both lengths in it.
const expectedResults = {
  "js_value::tests::from_entries_panics_when_values_is_shorter_than_keys": "ok",
  "js_value::tests::from_entries_panics_when_keys_is_shorter_than_values": "ok",
};

test.skipIf(!miriAvailable)(
  "JSValue::from_entries rejects mismatched key/value lengths with debug assertions disabled",
  async () => {
    await using proc = Bun.spawn({
      // `--lib`: rustdoc does not get the profile's debug-assertions setting,
      // so the doctest pass would not compile against the deps built below.
      cmd: [cargoBin!, "miri", "test", "--locked", "--lib", "-p", "bun_jsc", "--", "js_value::tests::from_entries"],
      cwd: repoRoot,
      env: {
        ...process.env,
        CARGO_PROFILE_TEST_DEBUG_ASSERTIONS: "false",
        // One-shot build of ~60 crates: incremental state would be several
        // times the size of the artifacts themselves and never reused.
        CARGO_INCREMENTAL: "0",
        MIRIFLAGS: "-Zmiri-tree-borrows",
        CARGO_TERM_COLOR: "never",
      },
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
  300_000,
);
