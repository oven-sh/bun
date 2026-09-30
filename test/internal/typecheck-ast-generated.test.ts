import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generate, normalize } from "../../src/typecheck/ast/generate.ts";

// The node definitions and the kinds are generated from ast.json; regenerate them (`bun src/typecheck/ast/generate.ts`) when it or the generator changes.
test.each(["kind", "ast"] as const)("%s_generated.rs is up to date", part => {
  const dir = join(import.meta.dir, "../../src/typecheck/ast");
  const expected = generate(readFileSync(join(dir, "ast.json"), "utf8"))[part];
  expect(normalize(readFileSync(join(dir, `${part}_generated.rs`), "utf8"))).toBe(normalize(expected));
});
