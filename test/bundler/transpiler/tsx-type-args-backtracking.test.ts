import { expect, test } from "bun:test";

// Regression test for quadratic backtracking in the TypeScript parser, found
// by fuzzing.
//
// In expression position, `foo <` makes the parser speculatively scan "is this
// a type argument list?", restoring the lexer when the scan fails. A chain
// like `A<Promise<T<T<T<...` (the fuzz input was ~21KB of repeated `<T`) made
// every `<` start a speculative scan that consumed the entire rest of the
// chain before failing, so total work was quadratic in the input length and
// the input appeared to hang the transpiler.
//
// Failed scans are now memoized by the byte offset of their opening `<`,
// recorded at every nesting level as the failure unwinds, so each offset is
// scanned at most once and the parse stays near-linear. The chains here are
// kept shallow (500 levels) so the scans fail by reaching the `;` instead of
// tripping the parser's stack guard on any platform's stack size; stack-guard
// failures are deliberately not memoized because they depend on the recursion
// depth at entry, not on the offset.
test("repeated unclosed type-argument speculation is not quadratic", () => {
  // Each statement is `A<Promise<T<T...<T>>;`: 500 unclosed `<T` units whose
  // speculative scans all fail at the `;`, except the final `T<T<T>>`, which
  // really does parse as `T` with erased type arguments (`;` may follow a
  // type argument list). 120 independent statements keep the memoized parse
  // well under a second on a debug+ASAN build while the unfixed quadratic
  // cost (~15s) blows the time budget many times over.
  // (`Buffer.alloc` fill over `.repeat` — the latter is very slow in debug JSC.)
  const units = 500;
  const statements = 120;
  const chain = Buffer.alloc("<T".length * units, "<T").toString();
  const statement = `A<Promise${chain}>>;\n`;
  const source = Buffer.alloc(statement.length * statements, statement).toString();

  const transpiler = new Bun.Transpiler({ loader: "tsx" });
  const start = performance.now();
  const output = transpiler.transformSync(source);
  const elapsed = performance.now() - start;

  // Every `<` in the chain is a less-than comparison except the collapsed
  // generic tail, so the output shape proves the speculation outcomes were
  // unchanged by the memo.
  const expectedStatement = "A < Promise" + Buffer.alloc(" < T".length * (units - 2), " < T").toString() + ";\n";
  expect(output).toBe(Buffer.alloc(expectedStatement.length * statements, expectedStatement).toString());

  expect(elapsed).toBeLessThan(5_000);
});
