// A request to end a Worker is taken wherever the engine looks for an exception, so any call that looks may come back with one.
// Code that states that nothing was thrown (assertNoException, releaseAssertNoException) puts such a request off while it runs
// (DeferTerminationForAWhile), and the request is taken at the next look behind it. Goes by the text of the engine's sources.
import { expect, test } from "bun:test";
import { closingOf, filesOfCompiler, lineOf, sayWhenSkipped, sources } from "./harness/engine-text";

sayWhenSkipped("test/aot/what-states-that-nothing-was-thrown-puts-the-end-of-a-worker-off.test.ts");

test.skipIf(!sources)("each statement that nothing was thrown stands behind a deferral in its function", () => {
  const found: string[] = [];
  let statements = 0;
  for (const { name, text } of filesOfCompiler()) {
    // A function's body opens at the start of a line.
    for (const { index } of text.matchAll(/^\{/gm)) {
      const body = text.slice(index, closingOf(text, index));
      for (const statement of body.matchAll(/\b(\w+)\s*\.\s*(?:releaseAssertNoException|assertNoException)\s*\(/g)) {
        statements++;
        const before = body.slice(0, statement.index);
        // Right behind the declaration of its scope it speaks of what the caller hands over: nothing has been called yet.
        if (
          new RegExp(`\\bauto\\s+${statement[1]}\\s*=\\s*DECLARE_\\w+_SCOPE\\s*\\(\\s*\\w+\\s*\\)\\s*;\\s*$`).test(
            before,
          )
        )
          continue;
        if (!/\bDeferTermination(?:ForAWhile)?\b/.test(before))
          found.push(`${name}:${lineOf(text, index + statement.index)}`);
      }
    }
  }
  expect(found).toEqual([]);
  expect(statements).toBeGreaterThan(0);
});
