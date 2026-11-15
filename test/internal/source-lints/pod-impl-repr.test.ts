import { file } from "bun";
import { expect, test } from "bun:test";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `impl_pod!`, `impl_no_uninit!` and `impl_any_bit_pattern!` (src/pod) make rustc
// prove that viewing a type as bytes is sound. They cannot see the type's `repr`,
// and rustc orders the fields of a `repr(Rust)` struct as it likes:
//
//   struct S { a: u8, b: u32, c: u8, d: u16 }
//
// passes, because the order rustc picks leaves no padding, and its bytes are
// b, d, a, c. A lockfile or wire struct that forgot `#[repr(C)]` would be written
// in an order the next toolchain may change. So every type named in one of the
// three macros is defined in the same file, under a `#[repr(..)]`.

/** The types `source` gives a byte view without a `#[repr(..)]` on their definition in `source`. */
function withoutRepr(source: string): string[] {
  const lines = source.replace(/^\s*\/\/.*\n/gm, "").split("\n");
  const names = [...lines.join("\n").matchAll(/\bimpl_(?:pod|no_uninit|any_bit_pattern)!\s*\(([^)]*)\)/g)]
    .flatMap(([, list]) => list.split(","))
    .map(name => name.trim())
    .filter(Boolean);
  return names.filter(name => {
    const definition = new RegExp(
      `^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:struct|enum|union)\\s+${RegExp.escape(name)}\\b`,
    );
    let at = lines.findIndex(line => definition.test(line));
    if (at === -1) return true;
    // The attributes are the lines above, up to the end of the previous item.
    while (at > 0 && !/^\s*$|[;}]\s*$/.test(lines[at - 1])) {
      if (/#\[repr\(/.test(lines[--at])) return false;
    }
    return true;
  });
}

test("finds a type without a repr", () => {
  const fields = "{ a: u8, b: u32 }\nbun_core::impl_pod!(S);\n";
  expect(withoutRepr(`#[derive(Clone, Copy)]\npub struct S ${fields}`)).toEqual(["S"]);
  expect(withoutRepr(`#[repr(C)]\nstruct Other;\n\n#[derive(Clone, Copy)]\nstruct S ${fields}`)).toEqual(["S"]);
  expect(withoutRepr(`use other::S;\nbun_core::impl_pod!(S);\n`)).toEqual(["S"]);
  expect(
    withoutRepr(`#[repr(C)]\n/// Docs.\n#[derive(\n    Clone,\n    Copy,\n)]\npub(crate) struct S ${fields}`),
  ).toEqual([]);
});

test("every type given a byte view has a #[repr(..)]", async () => {
  const root = path.resolve(import.meta.dir, "..", "..", "..");
  const offenders: string[] = [];
  let users = 0;
  for (const abs of globAllSources().rust) {
    const source = path.relative(root, abs).replaceAll(path.sep, "/");
    // src/pod defines the macros and uses them on primitives.
    if (!source.endsWith(".rs") || source.startsWith("src/pod/")) continue;
    const text = await file(abs).text();
    if (!/\bimpl_(?:pod|no_uninit|any_bit_pattern)!/.test(text)) continue;
    users++;
    offenders.push(...withoutRepr(text).map(name => `${source}: ${name}`));
  }
  expect(users).toBeGreaterThan(10);
  expect(offenders).toEqual([]);
});
