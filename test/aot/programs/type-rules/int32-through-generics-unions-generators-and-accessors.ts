// A `number` is held to the promise wherever the position it goes to is written `int32` after the types are worked out: a type argument that is inferred as `number`, a parameter that is a union or optional, a member of a mapped type, `typeof` of an int32, what `yield` gives and takes, a setter, a field that is only declared, `satisfies`. structural-types/an-int32-comes-out-of-generic-functions-and-classes and its neighbors have the ways that the build accepts.
import type { int32 } from "bun";

const given: number[] = JSON.parse("[1.5]");
const n: number = given[0];
function same<T>(value: T): T { return value; }
const inferred: int32 = same(n);
function either(value: int32 | string): int32 { return typeof value === "number" ? value : 0; }
function maybe(value?: int32): int32 { return value ?? 0; }
type Ints<T> = { [K in keyof T]: int32 };
const mapped: Ints<{ a: string }> = { a: n };
const model: int32 = 1;
let likeTheModel: typeof model = n;
function* taking(): Generator<int32, void, int32> { const got: int32 = yield 1; console.log(got); }
function* giving(): Generator<int32, void, void> { yield n; }
class Counter {
  count: int32 = 0;
  declare never: int32;
  get size(): int32 { return this.count; }
  set size(value: int32) { this.count = value; }
}
const counter = new Counter();
counter.size = n;
const neverStored: int32 = counter.never;
const satisfied: int32 = n satisfies int32;

console.log(inferred, either(n), maybe(n), mapped, likeTheModel, taking().next(), giving().next(), counter, neverStored, satisfied);
