import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Bun links no libuv. src/jsc/bindings/libuv holds libuv's headers for the
// uv_* stubs and polyfills that Node-API addons import, and uv-polyfills.h is
// the one place that includes uv.h. On Windows uv.h includes uv/win.h, which
// includes winsock2.h and windows.h and defines SIGHUP, SIGKILL, S_IFLNK, F_OK
// and friends; in a unified build those leak into every source file that
// follows in the same bundle. A file that needs one uv_* function declares it;
// a file that needs the UV__E* numbers includes <uv/errno.h>, which defines
// only those.
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
