import { expect, test } from "bun:test";
import { parseRust, type Attribute, type RustFile } from "../../../scripts/rust-parser/index.ts";
import { rustSources } from "./rust-sources.ts";

// bun_windows_sys is depended on unconditionally (not behind
// [target.'cfg(windows)']) by several workspace crates that need its Win32 POD
// typedefs on every target. A bare #[link(name = "...")] on any extern block
// therefore bakes -lntdll / -lkernel32 / ... into the rlib on non-Windows
// hosts, and cargo test / cargo bench for any transitive dependent fails to
// link with "ld.lld: error: unable to find library -lntdll".
//
// The bare spelling is correct elsewhere in the tree (e.g. backend_wic.rs,
// threading/Mutex.rs) where the enclosing module is already #[cfg(windows)],
// so this lint is scoped to externs.rs only.
const EXTERNS = "src/windows_sys/externs.rs";

/**
 * Bare `#[link(name = "...")]` attributes, wherever the `name = ...` sits in
 * the list. A gated one is spelled `#[cfg_attr(windows, link(name = "..."))]`,
 * an attribute named `cfg_attr`, so it never matches. `#[link_name = "..."]`
 * (symbol rename) is a different attribute and is fine.
 */
function findBareLinkAttrs(file: RustFile): Attribute[] {
  return file
    .find("Attribute")
    .filter(
      attr =>
        attr.name === "link" &&
        attr.meta.kind === "MetaList" &&
        attr.meta.items.some(item => item.kind === "MetaNameValue" && item.path === "name"),
    );
}

test("the query recognizes the shapes it claims to", () => {
  const bare = (snippet: string) => {
    const file = parseRust(snippet);
    return findBareLinkAttrs(file).map(attr => file.text(attr));
  };
  expect(bare('#[link(name = "ntdll")]\nunsafe extern "system" {}')).toEqual(['#[link(name = "ntdll")]']);
  // `name` need not come first; the text match this replaced required it to.
  expect(bare('#[link(kind = "raw-dylib", name = "ntdll")]\nunsafe extern "system" {}')).toEqual([
    '#[link(kind = "raw-dylib", name = "ntdll")]',
  ]);
  expect(bare('#[cfg_attr(windows, link(name = "ntdll"))]\nunsafe extern "system" {}')).toEqual([]);
  expect(bare('unsafe extern "system" {\n    #[link_name = "NtClose"]\n    fn close();\n}')).toEqual([]);
  expect(bare('// #[link(name = "ntdll")]\nunsafe extern "system" {}')).toEqual([]);
});

test("bun_windows_sys: every #[link(name = ...)] is gated behind cfg(windows)", () => {
  const sources = rustSources({ scope: [EXTERNS] });
  // The file moved or was renamed: update `EXTERNS` rather than let the lint
  // pass on an empty scope.
  expect(sources.map(src => src.path)).toEqual([EXTERNS]);

  const violations: string[] = [];
  for (const src of sources) {
    for (const attr of findBareLinkAttrs(src.file)) {
      violations.push(`${src.file.location(attr)}: ${src.file.text(attr)}`);
    }
  }
  expect(violations).toEqual([]);
});
