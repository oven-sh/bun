import { describe, expect } from "bun:test";
import { readdirSync } from "fs";
import { itBundled } from "./expectBundled";

// Regression coverage for the DynamicBitSetUnmanaged / AutoBitSet rewrite.
//
// With more than AUTO_STATIC_BITS (= 127) entry points, the per-file and
// per-chunk `entry_bits` stored in LinkerGraph/Chunk flip from the inline
// ArrayBitSet arm to the heap-allocated DynamicBitSetUnmanaged arm, and
// chunk assignment runs `has_intersection` / `clone` / `set` / Drop on the
// dynamic path for every (file × entry) pair. This test pins that path to a
// known-good output so future changes to the bitset storage (thin-pointer
// packing, Drop, resize) can't silently corrupt chunk assignment.

describe("bundler", () => {
  const N = 150; // > 127 so AutoBitSet::needs_dynamic(N) is true

  const files: Record<string, string> = {
    "/shared.js": `export const shared = 1;`,
  };
  const entryPoints: string[] = [];
  for (let i = 0; i < N; i++) {
    const p = `/e${i}.js`;
    files[p] = `import { shared } from "./shared.js"; console.log(shared + ${i});`;
    entryPoints.push(p);
  }
  // Spot-check first / mid / last entries (running all N is too slow); the
  // onAfterBundle chunk-shape check below covers the full set.
  const run = [0, 64, 127, N - 1].map(i => ({
    file: `/out/e${i}.js`,
    stdout: String(1 + i),
  }));

  itBundled("splitting/DynamicEntryBitsManyEntrypoints", {
    files,
    entryPoints,
    splitting: true,
    run,
    onAfterBundle(api) {
      // With splitting, `shared.js` must land in exactly one shared chunk
      // (not be duplicated into every entry). If entry_bits intersection is
      // wrong the linker either over-splits or inlines `shared` everywhere.
      const outputs = readdirSync(api.outdir).filter(f => f.endsWith(".js"));
      let copies = 0;
      for (const f of outputs) {
        if (api.readFile("/out/" + f).includes("shared = 1")) copies++;
      }
      expect(copies).toBe(1);
      // Exactly N entry chunks + 1 shared chunk.
      expect(outputs.length).toBe(N + 1);
    },
  });
});
