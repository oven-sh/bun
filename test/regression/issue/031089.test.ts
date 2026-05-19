// Regression test for https://github.com/oven-sh/bun/issues/31089
//
// Soundness: `bun_core::AtomicCell<T>` previously bounded its
// `unsafe impl Send`/`Sync` on `T: Copy` alone, so a `Copy + !Send`
// user type (e.g. anything wrapping `PhantomData<*const ()>` or
// `Cell<_>`) with a hand-written `Atom` impl could be laundered
// across threads by wrapping it in `AtomicCell`. The fix gates the
// impls on a new `AtomCrossThread` marker trait (primitives + the
// three pointer shapes opt in explicitly); a downstream `Copy + !Send`
// payload now fails at compile time.
//
// The companion `031089-fixture/` crate intentionally tries the
// launder. With the fix in place `cargo check` fails with
// `E0277 the trait bound \`Evil: AtomCrossThread\` is not satisfied`;
// without the fix it compiles, which is exactly the soundness bug.
// This test asserts both outcomes.

import { expect, test } from "bun:test";
import { spawn, which } from "bun";
import { join } from "node:path";

const cargo = which("cargo");
const fixtureDir = join(import.meta.dir, "031089-fixture");

test.skipIf(!cargo)(
  "AtomicCell<Copy + !Send> fails to compile (soundness bound via AtomCrossThread)",
  { timeout: 10 * 60 * 1000 }, // first run compiles bun_core's dep graph; cached after
  async () => {
    // `cargo check` builds the dep graph then type-checks the fixture
    // lib.rs. The fixture calls `assert_send::<bun_core::AtomicCell<Evil>>()`
    // where `Evil: Copy + !Send + !Sync`. With the production fix the
    // `Send`/`Sync` impls require `T: AtomCrossThread`, which `Evil`
    // doesn't implement — E0277 fires.
    await using proc = spawn({
      cmd: [cargo!, "check", "--message-format=short"],
      cwd: fixtureDir,
      env: { ...process.env, CARGO_TERM_COLOR: "never" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    const out = stdout + stderr;

    // Expected failure — the fixture deliberately tries the launder.
    expect({
      exitCode,
      mentionsE0277: out.includes("E0277"),
      mentionsAtomCrossThread: out.includes("AtomCrossThread"),
      mentionsEvil: out.includes("Evil"),
    }).toEqual({
      exitCode: 101, // cargo check exits 101 on type errors
      mentionsE0277: true,
      mentionsAtomCrossThread: true,
      mentionsEvil: true,
    });
  },
);
