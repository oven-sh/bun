import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { patterns } from "../../../scripts/glob-sources.ts";

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

  const iostreamInclude = /^\s*#\s*include\s*<iostream>/m;
  const violations: string[] = [];
  const check = (relFromRepo: string) => {
    if (iostreamInclude.test(readFileSync(path.join(repoRoot, relFromRepo), "utf8"))) {
      violations.push(relFromRepo.replaceAll("\\", "/"));
    }
  };

  // The translation units the build compiles: the patterns it expands, plus
  // the Windows-only sources scripts/build/bun.ts adds by hand.
  let compiled = 0;
  for (const pattern of [...patterns.cxx.paths, "src/jsc/bindings/windows/*.cpp"]) {
    for await (const rel of new Glob(pattern).scan({ cwd: repoRoot })) {
      compiled++;
      check(rel);
    }
  }
  expect(compiled).toBeGreaterThan(0);

  // Headers are not in the build's source lists, so scan every header under
  // the roots the compiled sources include from.
  const roots = ["src", "packages/bun-uws", "packages/bun-usockets"];
  for (const root of roots) {
    let scanned = 0;
    for await (const rel of new Glob("**/*.{h,hpp,hxx}").scan({ cwd: path.join(repoRoot, root) })) {
      scanned++;
      check(path.join(root, rel));
    }
    // Guard against repoRoot resolving wrong (test file moved) or a scanned
    // root going away, which would make the ban below pass vacuously.
    expect(scanned).toBeGreaterThan(0);
  }

  violations.sort();
  expect(violations).toEqual([]);
});
