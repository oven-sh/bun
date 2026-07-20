// Smoke coverage for runtime paths backed by `bun_core::cast` (the in-tree
// safe-transmute helpers). Each case exercises a `cast_slice` call site so a
// regression in the slice-reinterpretation logic surfaces as a concrete value
// mismatch rather than a hard-to-localize downstream failure. `bytes_of`,
// `cast_ref`, and `pod_read_unaligned` are covered by the cargo unit tests in
// `src/bun_core/cast.rs`.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// `&[u16]` ↔ `&[u8]` via `cast_slice` / `cast_slice_mut` (encoding.rs).
test("utf16le Buffer encoding round-trips through the u16/u8 slice cast", () => {
  const s = "aé中𝌆"; // 1-byte, 2-byte, 3-byte, surrogate pair
  const buf = Buffer.from(s, "utf16le");
  expect([...buf]).toEqual([0x61, 0x00, 0xe9, 0x00, 0x2d, 0x4e, 0x34, 0xd8, 0x06, 0xdf]);
  expect(buf.toString("utf16le")).toBe(s);
});

// `&[u8]` → `&[f16]` via `cast_slice` with the local `f16: Pod` impl
// (util.rs / ConsoleObject.rs). A bad length recomputation would print the
// wrong element count; a bad bit-reinterpretation would print wrong values.
test("Float16Array inspection reads element values through the u8/f16 slice cast", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      // 0x3c00 = 1.0, 0x4000 = 2.0, 0xc200 = -3.0, 0x3e00 = 1.5 (IEEE-754 binary16)
      `const b = new Uint16Array([0x3c00, 0x4000, 0xc200, 0x3e00]);
       const f = new Float16Array(b.buffer);
       process.stdout.write(Bun.inspect(f));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toContain("Float16Array(4)");
  expect(stdout).toContain(" 1");
  expect(stdout).toContain(" 2");
  expect(stdout).toContain(" -3");
  expect(stdout).toContain(" 1.5");
  expect(exitCode).toBe(0);
});
