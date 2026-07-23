import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// <iostream> is unique among the C++ stream headers: on libstdc++ it emits a
// reference to std::ios_base_library_init in every TU that includes it, which
// forces libstdc++'s globals_io.o into the link. That object's
// _GLOBAL__sub_I.00090_globals_io.cc initializer constructs cin/cout/cerr/clog
// (and the wchar_t variants) before main, dragging the full std::locale facet
// set (ctype/numpunct/moneypunct/timepunct/messages for char and wchar_t) into
// every Bun process startup. Bun never touches C++ iostreams at runtime.
//
// <ostream>, <istream>, <sstream> and <fstream> are fine: they declare the
// stream types but do not emit the static Init object. If you need to print to
// stderr from C++, use fputs/fprintf.
//
// The upstream source of the original leak was the vendored simdutf header
// inside WebKit (Source/WTF/wtf/simdutf/simdutf_impl.h); that is handled by
// the WebKit pin. This test guards Bun's own compiled C++ so the initializer
// cannot creep back in through packages/ or src/.
test("C++ sources compiled into Bun do not include <iostream>", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

  const roots = ["src", "packages/bun-uws", "packages/bun-usockets"];
  // sizegen.cpp is a build-time code generator, not linked into the bun binary.
  const allowlist = new Set(["src/jsc/headergen/sizegen.cpp"]);

  const iostreamInclude = /^\s*#\s*include\s*<iostream>/m;
  const violations: string[] = [];

  for (const root of roots) {
    const glob = new Glob("**/*.{h,hpp,hxx,cpp,cc,cxx}");
    for await (const rel of glob.scan({ cwd: path.join(repoRoot, root) })) {
      const relFromRepo = path.join(root, rel).replaceAll("\\", "/");
      if (allowlist.has(relFromRepo)) continue;
      const source = readFileSync(path.join(repoRoot, root, rel), "utf8");
      if (iostreamInclude.test(source)) {
        violations.push(relFromRepo);
      }
    }
  }

  violations.sort();
  expect(violations).toEqual([]);
});
