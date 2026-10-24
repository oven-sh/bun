// A request to end a Worker is taken wherever the engine looks for an exception, so any call that looks may come back with one.
// Code that states that nothing was thrown (releaseAssertNoException) puts such a request off while it runs
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
      for (const statement of body.matchAll(/\breleaseAssertNoException\s*\(/g)) {
        statements++;
        if (!/\bDeferTermination(?:ForAWhile)?\b/.test(body.slice(0, statement.index)))
          found.push(`${name}:${lineOf(text, index + statement.index)}`);
      }
    }
  }
  expect(found).toEqual([]);
  expect(statements).toBeGreaterThan(0);
});
