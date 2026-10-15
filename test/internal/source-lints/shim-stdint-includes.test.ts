import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import path from "node:path";

// The platform shims (src/image/image_wic_shim.cpp) are deliberately header-light: they
// are compiled against the platform SDK (a Visual Studio install or an xwin
// splat for Windows, the macOS SDK for CoreGraphics) rather than against
// WTF/JSC, so nothing else pulls in the C standard headers for them.
//
// Fixed-width integer types are the trap: a Visual Studio header set happens
// to provide int32_t & co. transitively, while the xwin-splatted SDK used for
// Linux→Windows cross-compiles does not. A shim that uses them without
// including <cstdint> compiles natively and only breaks the cross build —
// and the "redundant-looking" include is an easy target for cleanup. Keep the
// dependency explicit.
test("SDK shims that use fixed-width integer types include <cstdint>", () => {
  const root = path.resolve(import.meta.dir, "..", "..", "..");
  const shims = [...new Glob("src/**/*_shim.cpp").scanSync({ cwd: root })].sort();
  expect(shims.length).toBeGreaterThan(0);

  const fixedWidthType = /\b(?:u?int(?:8|16|32|64)_t|intptr_t|uintptr_t)\b/;
  const stdintInclude = /#include\s*<(?:cstdint|stdint\.h)>/;

  const violations = shims
    .filter(name => {
      const source = readFileSync(path.join(root, name), "utf8");
      return fixedWidthType.test(source) && !stdintInclude.test(source);
    })
    .map(name => `${name} uses fixed-width integer types but does not include <cstdint>`);

  expect(violations).toEqual([]);
});
