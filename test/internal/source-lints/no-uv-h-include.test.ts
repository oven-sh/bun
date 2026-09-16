import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// On Windows uv.h pulls in windows.h and winsock2.h and defines SIGHUP, S_IFLNK, F_OK and friends; in a
// unified build those leak into every later file of the bundle. Declare the one uv_* function you need, or
// include <uv/errno.h> for the UV__E* numbers.
test("only uv-polyfills.h includes uv.h", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

  const roots = ["src", "packages/bun-uws", "packages/bun-usockets"];
  const allowed = new Set(["src/jsc/bindings/uv-polyfills.h"]);
  const uvInclude = /^\s*#\s*include\s*[<"]uv\.h[>"]/m;
  const violations: string[] = [];

  for (const root of roots) {
    let scanned = 0;
    const glob = new Glob("**/*.{h,hpp,hxx,c,cpp,cc,cxx,mm}");
    for await (const rel of glob.scan({ cwd: path.join(repoRoot, root) })) {
      scanned++;
      const relFromRepo = path.join(root, rel).replaceAll("\\", "/");
      if (allowed.has(relFromRepo)) continue;
      const source = readFileSync(path.join(repoRoot, root, rel), "utf8");
      if (uvInclude.test(source)) {
        violations.push(relFromRepo);
      }
    }
    // A root that resolves wrong would make the ban below pass vacuously.
    expect(scanned).toBeGreaterThan(0);
  }

  violations.sort();
  expect(violations).toEqual([]);
});
