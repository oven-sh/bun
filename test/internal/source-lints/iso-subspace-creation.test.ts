import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Every JS class with C++ fields has a subspaceFor<T>() that JSC calls on each
// allocation of T. Creating the IsoSubspace behind it (lock the heap, build it,
// register it, build the per-VM GCClient::IsoSubspace, fill both slots) is about
// 640 bytes of code that runs once per type. Until #39770 that creation path
// lived in the ALWAYS_INLINE WebCore::subspaceForImpl template, so the binary
// carried one copy of it per class; taking them out of line saved about 160 KB
// of the stripped linux-x64 binary.
//
// It now lives in exactly one out-of-line function, subspaceForImplSlow in
// BunClientData.cpp (the file that also constructs the two subspaces JSHeapData
// owns eagerly). subspaceForImpl<T> passes it a per-type constant table and the
// two slot offsets from BUN_SUBSPACE_SLOTS. A new class needs a slot in
// DOMIsoSubspaces.h and DOMClientIsoSubspaces.h and a subspaceFor that calls
// WebCore::subspaceForImpl; it never constructs an IsoSubspace itself.
const creationSite = "src/jsc/bindings/BunClientData.cpp";

const constructsIsoSubspace =
  /\bISO_SUBSPACE_INIT(?:_WITH_NAME)?\b|\b(?:makeUnique|makeUniqueWithoutFastMallocCheck|make_unique)\s*<\s*(?:JSC::)?(?:GCClient::)?IsoSubspace\s*>|\bnew\s+(?:JSC::)?(?:GCClient::)?IsoSubspace\b/;

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
