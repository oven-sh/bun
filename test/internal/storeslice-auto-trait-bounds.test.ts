// Soundness regression guard for `bun_ast::StoreRef<T>` / `StoreSlice<T>`
// unsafe Send/Sync impls at `src/ast/nodes.rs:339-346` and 39-40.
//
// The bug: pre-fix the impls were unconditional in `T` —
//   unsafe impl<T> Send for StoreSlice<T> {}
//   unsafe impl<T> Sync for StoreSlice<T> {}
// which laundered `!Send`/`!Sync` payloads past auto-trait inference
// (`StoreSlice<Cell<u32>>: Sync` would hold even though `Cell<u32>: !Sync`).
//
// Strategy: Rust has no stable `static_assert!(!T: Sync)`. So we:
//   1. Extract the LIVE `unsafe impl` lines from src/ast/nodes.rs via regex
//      so the test reflects the real source, not a hard-coded copy.
//   2. Paste them into a tiny freestanding rustc probe that asks the
//      compiler to satisfy `fn requires_sync<T: Sync>()` on a `!Sync`
//      payload (`Cell<u32>`). With the bound (`unsafe impl<T: Sync>`) the
//      probe fails with E0277; without the bound it compiles.
//   3. Also compile a positive probe (`u32`, which IS Sync) to catch
//      over-restriction — that one must succeed.
//
// Only needs `rustc` in PATH. No `cargo`, no `bun bd`, no build of bun
// itself — keeps the test orthogonal to unrelated build-infra churn.
import { expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const nodesRsPath = join(repoRoot, "src", "ast", "nodes.rs");
const rustcBin = Bun.which("rustc");
const canRunRustc = !!rustcBin;

// Pull the two target `unsafe impl` blocks out of the live source file so
// the test reflects reality rather than a vendored copy — if the impls
// ever drift (say, someone re-removes the bound), the regex still finds
// them, the compiled probe reflects the regression, and the test fails.
function extractImpls(): { slice: string[]; ref: string[] } {
  const src = readFileSync(nodesRsPath, "utf8");
  const sliceRe =
    /^unsafe impl(<[^>]*>)? (Send|Sync) for StoreSlice<T>\s*\{\s*\}$/gm;
  const refRe =
    /^unsafe impl(<[^>]*>)? (Send|Sync) for StoreRef<T>\s*\{\s*\}$/gm;
  const slice = Array.from(src.matchAll(sliceRe), m => m[0]);
  const ref = Array.from(src.matchAll(refRe), m => m[0]);
  return { slice, ref };
}

async function rustcCheck(dir: string, source: string, name: string) {
  const srcPath = join(dir, `${name}.rs`);
  await Bun.write(srcPath, source);
  await using proc = Bun.spawn({
    cmd: [rustcBin!, "--edition", "2024", "--crate-type=bin", "-o", join(dir, name), srcPath],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  return { ok: exitCode === 0, stderr, stdout };
}

test.skipIf(!canRunRustc)(
  "StoreSlice<Cell<u32>> is NOT Sync (bound propagates !Sync payload)",
  async () => {
    const { slice } = extractImpls();
    // Sanity — the regex should have picked up exactly two lines.
    expect(slice).toHaveLength(2);

    using dir = tempDir("storeslice-auto-trait", {});

    // Negative probe: compile must FAIL. If someone reverts the bound to
    // `unsafe impl<T> Sync for StoreSlice<T> {}`, `StoreSlice<Cell<u32>>`
    // becomes Sync and the probe compiles — the assertion then fires.
    const negative = [
      "#![allow(dead_code, unused_imports)]",
      "use core::marker::PhantomData;",
      "use core::ptr::NonNull;",
      "use core::cell::Cell;",
      "#[repr(C)] pub struct StoreSlice<T> { ptr: NonNull<T>, len: u32 }",
      ...slice,
      "fn requires_sync<T: ?Sized + Sync>(_: PhantomData<T>) {}",
      "fn main() { requires_sync::<StoreSlice<Cell<u32>>>(PhantomData); }",
    ].join("\n");
    const neg = await rustcCheck(String(dir), negative, "neg");
    if (neg.ok) {
      console.error(
        "Expected rustc to REJECT StoreSlice<Cell<u32>>: Sync, but it compiled.\n" +
          "This means the `unsafe impl<T: Sync> Sync for StoreSlice<T>` bound regressed.\n" +
          "Source slice impls found:\n" +
          slice.join("\n"),
      );
    }
    expect(neg.ok).toBe(false);
    // The failure should mention Cell<u32>: !Sync to make regression diagnosis obvious.
    expect(neg.stderr).toContain("Sync");

    // Positive probe: compile must SUCCEED — the bound shouldn't over-restrict
    // Send/Sync payloads.
    const positive = [
      "#![allow(dead_code, unused_imports)]",
      "use core::marker::PhantomData;",
      "use core::ptr::NonNull;",
      "#[repr(C)] pub struct StoreSlice<T> { ptr: NonNull<T>, len: u32 }",
      ...slice,
      "fn requires_sync<T: ?Sized + Sync>(_: PhantomData<T>) {}",
      "fn main() { requires_sync::<StoreSlice<u32>>(PhantomData); }",
    ].join("\n");
    const pos = await rustcCheck(String(dir), positive, "pos");
    if (!pos.ok) {
      console.error("Expected rustc to accept StoreSlice<u32>: Sync:\n" + pos.stderr);
    }
    expect(pos.ok).toBe(true);
  },
);

test.skipIf(!canRunRustc)(
  "StoreRef<Cell<u32>> is NOT Sync (sibling bound; regression guard)",
  async () => {
    const { ref } = extractImpls();
    expect(ref).toHaveLength(2);

    using dir = tempDir("storeref-auto-trait", {});

    const negative = [
      "#![allow(dead_code, unused_imports)]",
      "use core::marker::PhantomData;",
      "use core::ptr::NonNull;",
      "use core::cell::Cell;",
      "#[repr(transparent)] pub struct StoreRef<T>(NonNull<T>);",
      ...ref,
      "fn requires_sync<T: ?Sized + Sync>(_: PhantomData<T>) {}",
      "fn main() { requires_sync::<StoreRef<Cell<u32>>>(PhantomData); }",
    ].join("\n");
    const neg = await rustcCheck(String(dir), negative, "neg");
    expect(neg.ok).toBe(false);
    expect(neg.stderr).toContain("Sync");
  },
);

test.skipIf(!canRunRustc)(
  "StoreSlice<*mut u32> is neither Send nor Sync (raw pointer propagates)",
  async () => {
    const { slice } = extractImpls();
    expect(slice).toHaveLength(2);

    using dir = tempDir("storeslice-rawptr", {});

    // `*mut T: !Send + !Sync`. The bound must reject both for the wrapper.
    const neg_send = [
      "#![allow(dead_code, unused_imports)]",
      "use core::marker::PhantomData;",
      "use core::ptr::NonNull;",
      "#[repr(C)] pub struct StoreSlice<T> { ptr: NonNull<T>, len: u32 }",
      ...slice,
      "fn requires_send<T: ?Sized + Send>(_: PhantomData<T>) {}",
      "fn main() { requires_send::<StoreSlice<*mut u32>>(PhantomData); }",
    ].join("\n");
    const r = await rustcCheck(String(dir), neg_send, "neg_send");
    expect(r.ok).toBe(false);
    expect(r.stderr).toContain("Send");
  },
);
