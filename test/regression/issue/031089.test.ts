// Regression test for https://github.com/oven-sh/bun/issues/31089.
//
// Two soundness holes have to stay closed for `bun_core::AtomicCell<T>`:
//
//  1. `AtomicCell<T>: Send/Sync` must not be granted for every `T: Copy`
//     — a `Copy + !Send` payload (e.g. anything wrapping
//     `PhantomData<*const ()>`) would otherwise launder cross-thread.
//     That's the original #31089 finding.
//  2. The `unsafe_impl_atom!` macro must not silently grant the
//     `AtomCrossThread` marker to every caller. If it did, a downstream
//     `unsafe_impl_atom!(Evil)` would re-open the same hole through a
//     different door. (Coderabbit flagged this on #31090 and it's the
//     reason `Atom` and `AtomCrossThread` are two separate opt-ins.)
//
// The companion `031089-fixture/` crate exercises both: a plain `Evil`
// (no `Atom`) and an `EvilAtom` that DOES get `unsafe_impl_atom!`'d but
// never gets `AtomCrossThread`. With both halves of the fix in place
// `cargo check` emits four E0277s (two per fixture type, one for Send
// one for Sync); reverting either half removes the `EvilAtom` errors
// or the `Evil` errors respectively and this test catches it.

import { spawn, which } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";

const cargo = which("cargo");
const fixtureDir = join(import.meta.dir, "031089-fixture");

test.skipIf(!cargo)(
  "AtomicCell<Copy + !Send> fails to compile (soundness bound via AtomCrossThread)",
  { timeout: 10 * 60 * 1000 }, // first run compiles bun_core's dep graph; cached after
  async () => {
    await using proc = spawn({
      cmd: [cargo!, "check", "--message-format=short"],
      cwd: fixtureDir,
      env: { ...process.env, CARGO_TERM_COLOR: "never" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const out = stdout + stderr;

    // Both fixture types must fail the AtomCrossThread bound. Losing
    // either pair of errors means a soundness hole has reopened.
    expect({
      exitCode,
      mentionsE0277: out.includes("E0277"),
      mentionsAtomCrossThread: out.includes("AtomCrossThread"),
      rejectsEvil: out.includes("Evil: AtomCrossThread"),
      rejectsEvilAtom: out.includes("EvilAtom: AtomCrossThread"),
    }).toEqual({
      exitCode: 101, // cargo check exits 101 on type errors
      mentionsE0277: true,
      mentionsAtomCrossThread: true,
      rejectsEvil: true,
      rejectsEvilAtom: true,
    });
  },
);
