import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// The AST arena frees nothing before the whole AST is dropped: `AstAlloc::deallocate` is a no-op. What the React
// Compiler allocates to compile one function has to be freed when that function is done, so the HIR and the containers
// of the passes are on the global heap. Only what the output AST points to is made in the arena, and only by the files
// that build the output AST. See "Memory" in src/react_compiler/DESIGN.md.
//
//   AstAlloc::vec() / AstVec<T>                 → Vec::new() / Vec<T> / hir_vec![..]
//   StoreStr::new(buffer.leak())                → StoreStr::new(bun_ast::data_store_dupe_str(&buffer))
//   a list that a node of the output points to  → an AstVec in one of `outputFiles`
test("the React Compiler allocates in the AST arena only where it builds the output AST", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const directory = "src/react_compiler";
  // The files that build the output AST, relative to `directory`.
  const outputFiles = ["codegen.rs", "diagnostics/js_string.rs", "imports.rs", "pipeline.rs", "program.rs"];
  const banned = /\bAstAlloc\b|\bAstVec\b|\.leak\(\)/;
  const instead =
    "use a std container (Vec, hir_vec!), or copy bytes that the output AST keeps to the arena with " +
    `bun_ast::data_store_dupe_str. An arena list is built only in ${outputFiles.join(", ")}`;

  const found: string[] = [];
  const allocating = new Set<string>();
  let scanned = 0;
  for await (const rel of new Glob("**/*.rs").scan({ cwd: path.join(repoRoot, directory) })) {
    const file = rel.replaceAll("\\", "/");
    scanned++;
    readFileSync(path.join(repoRoot, directory, file), "utf8")
      .split("\n")
      .forEach((line, index) => {
        const match = /^\s*\/\//.test(line) ? null : banned.exec(line);
        if (match === null) return;
        if (outputFiles.includes(file)) allocating.add(file);
        else found.push(`${directory}/${file}:${index + 1}: ${match[0]}: ${instead}`);
      });
  }
  // Guard against repoRoot resolving wrong, which would make the ban pass vacuously.
  expect(scanned).toBeGreaterThan(50);
  expect(found.sort()).toEqual([]);
  // A file that no longer allocates in the arena leaves the list, here and in DESIGN.md.
  expect([...allocating].sort()).toEqual(outputFiles);
});
