import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `//# sourceMappingURL=<url>` is a URL on a `//` line. A writer that copies a
// file name or `publicPath` after it raw lets a line break in that string (LF,
// CR, U+2028, U+2029) end the comment. The rest of the string is then a line of
// the output: code in a bundle, declarations in a declaration file.
//
// So every line of Rust or C++ under src/ that mentions `sourceMappingURL=` is
// counted here, by file, next to what the file appends after the `=`. A line
// with `=data:` is not counted: base64 follows it, which cannot hold a line
// break. A comment line is not counted either.
const knownSites: Record<string, { lines: number; appends: string }> = {
  "src/bundler/Chunk.rs": { lines: 1, appends: "publicPath and the path of the map, both percent-encoded" },
  "src/sema/check/errors_declaration_emit.rs": { lines: 1, appends: "the name of the map through encodeURI, as tsc" },
  "src/runtime/bake/dev_server/incremental_graph.rs": { lines: 1, appends: "a fixed route prefix and a hex script id" },
  "src/sourcemap/lib.rs": { lines: 2, appends: "nothing: it finds the comment in a loaded file" },
  "src/js_parser/lexer.rs": { lines: 3, appends: "nothing: it reads the comment of an input file" },
  "src/css/css_parser.rs": { lines: 2, appends: "nothing: it reads the comment of an input file" },
};

const mention = /sourceMappingURL=(?!data:)/;

test("every line that mentions `sourceMappingURL=` is accounted for", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const found: Record<string, number> = {};
  let scanned = 0;

  for await (const rel of new Glob("src/**/*.{rs,cpp,h}").scan({ cwd: repoRoot })) {
    scanned++;
    const source = readFileSync(path.join(repoRoot, rel), "utf8");
    if (!source.includes("sourceMappingURL=")) continue;
    const lines = source.split("\n").filter(line => !line.trimStart().startsWith("//") && mention.test(line));
    if (lines.length > 0) found[rel.replaceAll("\\", "/")] = lines.length;
  }

  // Guards against the scan passing vacuously.
  expect(scanned).toBeGreaterThan(1000);

  // A count that differs means a new line mentions the comment. If that line
  // writes the comment, it must not append a raw string: a bundler output calls
  // append_source_mapping_url_comment, and anything else percent-encodes what
  // it appends or appends only bytes that cannot end a line. Then update
  // knownSites.
  expect(found).toEqual(Object.fromEntries(Object.entries(knownSites).map(([file, site]) => [file, site.lines])));
});
