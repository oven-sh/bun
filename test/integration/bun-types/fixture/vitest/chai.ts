import { assert, expectTypeOf, should } from "vitest";

assert(true, "a message");
assert.equal(1, 1);
assert.deepEqual({ a: 1 }, { a: 1 });
const narrowed: string | undefined = Math.random() > 2 ? undefined : "a";
assert.isDefined(narrowed);
expectTypeOf(narrowed).toBeString();
expectTypeOf(should).toBeFunction();
