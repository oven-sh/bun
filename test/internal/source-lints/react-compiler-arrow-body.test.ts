import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// The React Compiler lowers a function after the parser's visit pass. By then `E::Arrow::prefer_expr` is a request to
// the printer, not a fact about the source: with minify.syntax the visit pass also sets it on a block body that is one
// `return`. Lowering read it as "the body is an expression", so a component with the default
// `onClick = () => { return null; }` was compiled in a minified build only.
//
//   arrow.prefer_expr   → host.arrow_body(arrow) == ArrowBody::Expression
test("the lowering of the React Compiler asks the host how an arrow function is written", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const directory = "src/react_compiler/lowering";
  const found: string[] = [];
  let scanned = 0;
  for await (const rel of new Glob("**/*.rs").scan({ cwd: path.join(repoRoot, directory) })) {
    const file = path.join(directory, rel).replaceAll("\\", "/");
    scanned++;
    readFileSync(path.join(repoRoot, file), "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (!/^\s*\/\//.test(line) && /\.prefer_expr\b/.test(line)) found.push(`${file}:${index + 1}`);
      });
  }
  // Guard against repoRoot resolving wrong, which would make the ban pass vacuously.
  expect(scanned).toBeGreaterThan(5);
  expect(found).toEqual([]);
});
