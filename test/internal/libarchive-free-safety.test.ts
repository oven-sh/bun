// https://github.com/oven-sh/bun/issues/31972
//
// The libarchive RAII owners (ReadArchive/WriteArchive/OwnedEntry) deref to
// the opaque Archive/Entry handle types and free the handle on Drop. If those
// handle types expose SAFE explicit-free methods taking `&self`, safe Rust can
// free a handle through an owner and then Drop frees it again: a double free
// with no `unsafe` anywhere. The explicit-free methods must therefore be
// `unsafe fn` (a `&self` receiver cannot express that the call invalidates
// the handle).
import { expect, test } from "bun:test";
import path from "path";

const source = await Bun.file(path.join(import.meta.dir, "..", "..", "src", "libarchive", "lib.rs")).text();

test.each(["read_free", "write_free", "free"])("libarchive `%s(&self)` is an unsafe fn", name => {
  const decls = [
    ...source.matchAll(new RegExp(String.raw`(?:pub\s+)?(?:unsafe\s+)?fn\s+${name}\s*\(\s*&(?:mut\s+)?self`, "g")),
  ];
  // The method must exist (so a rename can't make this test pass vacuously),
  // and every declaration of it must be `unsafe`.
  expect(decls.length).toBeGreaterThan(0);
  for (const decl of decls) {
    expect(decl[0]).toInclude("unsafe");
  }
});
