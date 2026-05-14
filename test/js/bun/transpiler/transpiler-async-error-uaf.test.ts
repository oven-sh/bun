import { expect, test } from "bun:test";

test("async transform() rejection with parse errors does not crash", async () => {
  // When Bun.Transpiler().transform() runs on the thread pool, parse errors are
  // recorded using an arena allocator that is destroyed before the promise is
  // settled on the main thread. Converting those errors to JS previously read
  // the freed arena memory. Run enough iterations that mimalloc decommits the
  // arena's pages so the dangling read faults.
  let last: unknown;
  const pending: Promise<unknown>[] = [];
  for (let i = 0; i < 500; i++) {
    pending.push(
      new Bun.Transpiler().transform("a b c d").catch(e => {
        last = e;
      }),
    );
    if (i % 10 === 0) {
      await new Promise(r => setImmediate(r));
    }
  }
  await Promise.allSettled(pending);

  expect(last).toBeInstanceOf(AggregateError);
  const err = last as AggregateError;
  expect(err.message).toBe("Transform failed");
  expect(err.errors[0].message).toBe('Expected ";" but found "b"');
});
