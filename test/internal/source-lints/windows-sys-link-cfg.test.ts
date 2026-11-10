import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

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
test("bun_windows_sys: every #[link(name = ...)] is gated behind cfg(windows)", () => {
  const file = path.resolve(import.meta.dir, "..", "..", "..", "src", "windows_sys", "externs.rs");
  const source = readFileSync(file, "utf8");

  const violations: string[] = [];
  for (const [lineIndex, line] of source.split("\n").entries()) {
    const code = line.replace(/\/\/.*/, "");
    // Bare `#[link(name = ...)]` not wrapped in cfg_attr. `#[link_name = ...]`
    // (symbol rename) is a different attribute and is fine.
    if (/#\[\s*link\s*\(\s*name\s*=/.test(code) && !/cfg_attr\s*\(\s*windows/.test(code)) {
      violations.push(`src/windows_sys/externs.rs:${lineIndex + 1}: ${line.trim()}`);
    }
  }

  expect(violations).toEqual([]);
});
