/**
 * `strings::lexer_step::next_codepoint_multibyte` (src/bun_core/string/immutable.rs)
 * is the out-of-line non-ASCII tail of the JS lexer's `step()`. It is a safe
 * `pub fn`, but it used to copy the sequence out of `contents` with an unchecked
 * `copy_nonoverlapping` and relied on its caller (in another crate) having
 * checked that the cursor was inside `contents`: with the cursor past the end,
 * `len - current` wraps in the shipped profile and the copy reads past the
 * slice. It now slices `contents[current..]`, so the bounds check is its own.
 *
 * The lexer never passes a cursor past the end, so no JS input reaches this;
 * the behavior is pinned by the unit tests next to the function. Those are run
 * here through `cargo miri test` with the shipped profile's debug assertions and
 * overflow checks compiled out, so an unchecked cursor shows up as the
 * out-of-bounds read Miri reports rather than as an overflow panic (bun_core's
 * test binary does not link natively, and the crate is not in `bun run
 * rust:miri`'s set because its other tests call into C). Each test has to be
 * reported as passed. Skipped where miri is not installed or the cargo
 * workspace is not resolvable (test-only CI lanes run a prebuilt binary), the
 * same prerequisites as linear-fifo.test.ts.
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
  "string::immutable::tests::lexer_step_decodes_a_well_formed_sequence_and_steps_over_it": "ok",
  "string::immutable::tests::lexer_step_yields_a_byte_that_cannot_lead_a_sequence_as_itself": "ok",
  "string::immutable::tests::lexer_step_replaces_an_ill_formed_sequence_and_steps_over_its_lead_byte_only": "ok",
  "string::immutable::tests::lexer_step_reports_eof_for_a_sequence_cut_off_by_the_end_of_input": "ok",
  "string::immutable::tests::lexer_step_rejects_a_cursor_past_the_end_of_input": "ok",
};

test.skipIf(!miriAvailable)(
  "lexer_step::next_codepoint_multibyte bounds-checks the cursor itself and decodes as before",
  async () => {
    await using proc = Bun.spawn({
      cmd: [cargoBin!, "miri", "test", "--locked", "--lib", "-p", "bun_core", "--", "lexer_step"],
      cwd: repoRoot,
      env: {
        ...process.env,
        // Same aliasing model as `bun run rust:miri` (scripts/rust-miri.ts).
        MIRIFLAGS: "-Zmiri-tree-borrows",
        // The `test` profile inherits `dev`; these are the release profile's settings.
        CARGO_PROFILE_TEST_DEBUG_ASSERTIONS: "false",
        CARGO_PROFILE_TEST_OVERFLOW_CHECKS: "false",
        CARGO_TERM_COLOR: "never",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      // Miri's diagnostic (stderr) names the out-of-bounds access it stopped at;
      // libtest's own failure details are on stdout.
      console.error(stderr, stdout);
    }

    // libtest prints one line per test: `test <name>[ - should panic] ... ok`.
    const results: Record<string, string> = {};
    for (const [, name, status] of stdout.matchAll(/^test (\S+)(?: - should panic)? \.\.\. (\w+)$/gm)) {
      if (name in expectedResults) results[name] = status;
    }
    expect({ results, exitCode }).toEqual({ results: expectedResults, exitCode: 0 });
  },
  // Compiles bun_core and its dependencies for miri on the first run; the tests themselves are instant.
  300_000,
);
