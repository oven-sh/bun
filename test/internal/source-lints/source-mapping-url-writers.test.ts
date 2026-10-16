import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `//# sourceMappingURL=<url>` is a URL on a `//` line. A writer that copies a
// file name or `publicPath` after it raw lets a line break in that string (LF,
// CR, U+2028, U+2029) end the comment. The rest of the string is then a line of
// the output: code in a bundle, declarations in a declaration file.
//
// A string literal that stops at the `=` means the URL comes from somewhere
// else, so each file that has one is listed here with what follows the `=`.
// A `sourceMappingURL=data:...;base64,` literal is not matched: base64 cannot
// hold a line break.
const knownSites: Record<string, string> = {
  "src/bundler/Chunk.rs":
    "publicPath and the path of the map, both percent-encoded (append_source_mapping_url_comment)",
  "src/sema/check/errors_declaration_emit.rs": "the name of the map, percent-encoded as tsc's encodeURI does",
  "src/runtime/bake/dev_server/incremental_graph.rs": "a fixed route prefix and a hex script id",
  "src/sourcemap/lib.rs": "nothing: the needle that finds the comment in a loaded file",
};

const literalThatStopsAtTheUrl = /\/\/# sourceMappingURL="/;

test("every file that writes `//# sourceMappingURL=` is listed with what it appends", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const found = new Set<string>();
  let scanned = 0;

  for await (const rel of new Glob("src/**/*.rs").scan({ cwd: repoRoot })) {
    scanned++;
    const source = readFileSync(path.join(repoRoot, rel), "utf8");
    if (!source.includes("sourceMappingURL=")) continue;
    for (const line of source.split("\n")) {
      if (line.trimStart().startsWith("//")) continue;
      if (literalThatStopsAtTheUrl.test(line)) found.add(rel.replaceAll("\\", "/"));
    }
  }

  // Guards against the scan passing vacuously.
  expect(scanned).toBeGreaterThan(1000);

  // A new file here appends its own URL after the literal. A bundler output
  // calls append_source_mapping_url_comment. Anything else percent-encodes what
  // it appends, or appends only bytes that cannot end a line, before it is
  // added to knownSites.
  expect([...found].sort()).toEqual(Object.keys(knownSites).sort());
});
