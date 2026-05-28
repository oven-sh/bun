// `JsCell<T>` (src/jsc/JSCell.rs) is a `#[repr(transparent)]` wrapper over
// `UnsafeCell<T>` whose `get(&self) -> &T` is a SAFE function. Its `Send`/`Sync`
// impls must be gated on the inner type:
//
//   unsafe impl<T: Sync> Sync for JsCell<T> {}
//   unsafe impl<T: Send> Send for JsCell<T> {}
//
// If they were unconditional (`unsafe impl<T> ...`), a `&JsCell<T>` would be
// shareable across threads via any `Sync` container, and the safe `get()` would
// then hand out a `&T` to a `!Sync` `T` (`Rc`, `Cell`, `RefCell`) on another
// thread — UB with zero `unsafe` at the call site (oven-sh/bun#31498).
//
// This is a type-level invariant with no runtime surface, so the compiler checks
// it: a throwaway crate depends on the real `bun_jsc` and asserts `JsCell<Rc<u32>>`
// is `!Send + !Sync` via the auto-trait-ambiguity trick (stable Rust has no
// negative bounds). `cargo check` succeeds iff the bounds are present — with the
// unconditional impls `JsCell<Rc<u32>>` is `Send + Sync`, both blanket impls apply,
// and the build fails with E0283. `cargo check` does not link, so no C++/JSC objects
// are needed; it only needs the codegen the debug build already emitted.
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const cargo = Bun.which("cargo");
const repoRoot = path.resolve(import.meta.dir, "..", "..");
const jscCrate = path.join(repoRoot, "src", "jsc");

// `bun_jsc`'s build.rs pulls generated Rust from here; emitted by `bun bd`.
const codegenReady =
  existsSync(path.join(repoRoot, "build", "debug", "codegen", "cpp.rs")) &&
  existsSync(path.join(repoRoot, "build", "debug", "codegen", "generated_resolved_source_tag.rs"));

// Pin the same toolchain `bun bd` uses (the temp crate lives outside the repo, so
// it wouldn't otherwise pick up rust-toolchain.toml).
function pinnedToolchain(): string | undefined {
  try {
    const toml = readFileSync(path.join(repoRoot, "rust-toolchain.toml"), "utf8");
    return toml.match(/channel\s*=\s*"([^"]+)"/)?.[1];
  } catch {
    return undefined;
  }
}
const toolchain = pinnedToolchain();

// Host triple, for `--target` so the build.rs codegen path lines up.
function hostTriple(): string | undefined {
  if (!cargo) return undefined;
  const out = Bun.spawnSync({ cmd: [cargo, "-vV"], env: process.env }).stdout.toString();
  return out.match(/host:\s*(\S+)/)?.[1];
}
const triple = hostTriple();

const proof = `
use bun_jsc::JsCell;
use std::rc::Rc;

trait NotSend<A> { const OK: () = (); }
impl<T: ?Sized> NotSend<()> for T {}
impl<T: ?Sized + Send> NotSend<u8> for T {}

trait NotSync<A> { const OK: () = (); }
impl<T: ?Sized> NotSync<()> for T {}
impl<T: ?Sized + Sync> NotSync<u8> for T {}

// JsCell<Rc<u32>> must be !Send and !Sync. If either impl is unconditional the
// type gains the trait, both blanket impls apply, and this fails to compile (E0283).
const _: () = <JsCell<Rc<u32>> as NotSend<_>>::OK;
const _: () = <JsCell<Rc<u32>> as NotSync<_>>::OK;

// Positive direction: a Send/Sync inner type keeps the thread-affinity escape hatch.
const _: fn() = || {
    fn assert_send<T: Send>() {}
    fn assert_sync<T: Sync>() {}
    assert_send::<JsCell<u32>>();
    assert_sync::<JsCell<u32>>();
};

fn main() {}
`;

test.skipIf(!cargo || !codegenReady || !toolchain || !triple)(
  "JsCell<T>'s Send/Sync impls require T: Send/Sync (issue #31498)",
  async () => {
    // `[workspace]` detaches this crate from the repo's workspace; the absolute
    // path dep resolves `bun_jsc` regardless of cwd. The target dir lives inside
    // the temp dir so the run is self-contained and leaves the build untouched.
    using dir = tempDir("jscell-send-sync", {
      "Cargo.toml": `[package]
name = "jscell_send_sync_proof"
version = "0.0.0"
edition = "2021"

[[bin]]
name = "jscell_send_sync_proof"
path = "main.rs"

[dependencies]
bun_jsc = { path = ${JSON.stringify(jscCrate)} }

[workspace]
`,
      "main.rs": proof,
    });

    await using proc = Bun.spawn({
      // --offline: every dep is already in the cargo cache from `bun bd`; never
      // touch the network in CI.
      cmd: [cargo!, "check", "--quiet", "--offline", "--target", triple!],
      cwd: String(dir),
      env: {
        ...process.env,
        RUSTUP_TOOLCHAIN: toolchain!,
        CARGO_TARGET_DIR: path.join(String(dir), "target"),
        CARGO_TERM_COLOR: "never",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // `cargo check` must succeed — the negative assertions compile only when
    // `JsCell<Rc<u32>>` is correctly `!Send + !Sync`. E0283 is the signature of
    // the unconditional impls (both ambiguity blankets apply).
    const output = stdout + stderr;
    expect(output).not.toContain("E0283");
    expect(output).not.toMatch(/^error/m);
    expect(exitCode).toBe(0);
  },
  300_000,
);
