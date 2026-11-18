import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Every JS class with C++ fields has a subspaceFor<T>() that is called on each
// allocation of T. Most classes share a space with others of their size. One
// that needs a space of its own creates it once per VM, and a space is never
// freed before its heap.
//
// That happens in exactly one out-of-line function, subspaceForImplSlow in
// BunClientData.cpp, so that the ALWAYS_INLINE WebCore::subspaceForImpl template
// does not carry a copy per class. A new class needs a slot in
// DOMClientIsoSubspaces.h and a subspaceFor that calls WebCore::subspaceForImpl;
// it never creates an IsoSubspace itself.
const creationSite = "src/jsc/bindings/BunClientData.cpp";

const constructsIsoSubspace = /\bcreateIsoSubspace\b|\bheap_create_iso_space\b/;

function linesConstructingIsoSubspace(source: string): number[] {
  if (!constructsIsoSubspace.test(source)) return [];
  const lines: number[] = [];
  source.split("\n").forEach((line, index) => {
    const commentStart = line.indexOf("//");
    const code = commentStart === -1 ? line : line.slice(0, commentStart);
    if (constructsIsoSubspace.test(code)) lines.push(index + 1);
  });
  return lines;
}

test("IsoSubspaces are only constructed in BunClientData.cpp", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const src = path.join(repoRoot, "src");

  // The codegen templates are included because anything they emit is repeated
  // once per generated class.
  const globs = [new Glob("**/*.{h,cpp}"), new Glob("codegen/**/*.ts")];
  const violations: string[] = [];
  let scanned = 0;
  let linesInCreationSite = 0;

  for (const glob of globs) {
    for await (const rel of glob.scan({ cwd: src })) {
      if (rel.replaceAll("\\", "/").startsWith("engine/")) continue;
      scanned++;
      const relFromRepo = path.join("src", rel).replaceAll("\\", "/");
      const lines = linesConstructingIsoSubspace(readFileSync(path.join(src, rel), "utf8"));
      if (relFromRepo === creationSite) {
        linesInCreationSite = lines.length;
        continue;
      }
      for (const line of lines) violations.push(`${relFromRepo}:${line}`);
    }
  }

  // Guards against the scan passing vacuously: the globs must have found the
  // tree, and the one permitted file must still be where the creation lives.
  expect(scanned).toBeGreaterThan(1000);
  expect(linesInCreationSite).toBeGreaterThan(0);

  violations.sort();
  expect(violations).toEqual([]);
});
