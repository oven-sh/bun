// Compile-time soundness test for `bun_jsc::MarkedArrayBuffer`'s ownership
// boundary. Not a true regression (the hole was latent since the type was
// introduced, never "worked" in a prior release — see issue #31969), so it
// lives in test/regression/ rather than test/regression/issue/ per
// test/CLAUDE.md.
//
// `MarkedArrayBuffer::from_bytes(&mut [u8])` was a safe, public constructor
// that marked an arbitrary borrowed slice as allocator-owned
// (`owns_buffer: true`); the safe `destroy()` later freed that pointer with
// the default allocator. Safe code could therefore free a stack buffer:
//
//     let mut bytes = [0u8; 1];
//     let mut buffer = MarkedArrayBuffer::from_bytes(&mut bytes, JSType::Uint8Array);
//     buffer.destroy(); // frees the stack address
//
// The fix replaces it with `from_owned_bytes(Box<[u8]>, ..)` so the ownership
// transfer is enforced by the type system. The companion `-fixture/` crate
// contains exactly the unsound pattern above; with the fix in place
// `cargo check` rejects it (E0599: `from_bytes` no longer exists on
// `MarkedArrayBuffer`). If a safe borrowed-slice constructor is ever
// reintroduced, the fixture compiles again and this test fails.

import { spawn, which } from "bun";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const cargo = which("cargo");
const fixtureDir = join(import.meta.dir, "marked-array-buffer-ownership-soundness-fixture");
// bun_jsc's build script needs the cppbind codegen output (produced by
// `bun bd` / `bun run build`); skip on runners that only have a prebuilt
// bun binary and no build tree.
const codegenDir = join(import.meta.dir, "../../build/debug/codegen");
const hasCodegen = existsSync(join(codegenDir, "cpp.rs"));

test.skipIf(!cargo || !hasCodegen)(
  "MarkedArrayBuffer cannot adopt a borrowed slice as owned storage",
  { timeout: 10 * 60 * 1000 }, // first run type-checks bun_jsc's dep graph; cached after
  async () => {
    await using proc = spawn({
      // `--locked` so the fixture's committed Cargo.lock pins the transitive
      // dep graph — the assertions below only fire for the intended
      // resolution error, not for registry drift.
      cmd: [cargo!, "check", "--locked", "--message-format=short"],
      cwd: fixtureDir,
      env: {
        ...process.env,
        CARGO_TERM_COLOR: "never",
        BUN_CODEGEN_DIR: codegenDir,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const out = stdout + stderr;

    // A dep change anywhere in bun_jsc's graph invalidates the fixture's
    // committed lockfile; surface the regeneration command instead of an
    // opaque assertion diff.
    if (out.includes("--locked was passed")) {
      throw new Error(`fixture Cargo.lock is stale; run:\n  (cd ${fixtureDir} && cargo update)\n\n${out}`);
    }

    // The unsound pattern must fail to resolve. Check the content first,
    // exit code last — a missing-text failure (which prints cargo's output)
    // is a more useful signal than "cargo returned 0".
    expect(out).toContain("E0599");
    expect(out).toContain("from_bytes");
    expect(exitCode).toBe(101); // cargo check exits 101 on compile errors
  },
);

test("empty buffers round-trip without freeing the dangling sentinel", async () => {
  // An empty Box<[u8]> never allocates: its pointer is NonNull::dangling()
  // (0x1), not a heap address. destroy()/the GC deallocator must skip the
  // free for byte_len == 0 — under ASAN (the debug build), freeing 0x1
  // aborts with "free on address which was not malloc()-ed", so this test
  // discriminates: it crashes if the guard is removed.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require("node:fs");
      const path = require("node:path").join(require("node:os").tmpdir(), "empty-" + process.pid);
      fs.writeFileSync(path, "");
      for (let i = 0; i < 64; i++) {
        const buf = fs.readFileSync(path);          // empty Buffer via MarkedArrayBuffer
        if (buf.length !== 0) process.exit(1);
        const text = fs.readFileSync(path, "utf8"); // empty string path
        if (text !== "") process.exit(1);
      }
      Bun.gc(true);                                  // run deallocators
      fs.rmSync(path);
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

test("empty buffers round-trip without freeing the dangling sentinel", async () => {
  // An empty Box<[u8]> never allocates: its pointer is NonNull::dangling()
  // (0x1), not a heap address. destroy() and the JSC handoff must skip the
  // free for byte_len == 0 — under ASAN (the debug build), freeing 0x1
  // aborts, so this test discriminates if the guard is removed.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require("node:fs");
      const path = require("node:path").join(require("node:os").tmpdir(), "empty-" + process.pid);
      fs.writeFileSync(path, "");
      for (let i = 0; i < 64; i++) {
        const buf = fs.readFileSync(path);
        if (buf.length !== 0) process.exit(1);
        const text = fs.readFileSync(path, "utf8");
        if (text !== "") process.exit(1);
      }
      Bun.gc(true);
      fs.rmSync(path);
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
