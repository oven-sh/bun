import { expect, test } from "bun:test";

test("async transform() rejection with parse errors does not crash", async () => {
  // When a failing Bun.Transpiler().transform() rejects, Log.to_js builds an
  // AggregateError by allocating one BuildMessage JS cell per log entry. Those
  // cells were previously collected in a heap Vec<JSValue>, so the first cell
  // could be swept while allocating the second, leaving a zapped cell in the
  // aggregate and tripping the StructureID assertion during GC. Run enough
  // rejecting transforms that the allocation-triggered GC hits that window.
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
