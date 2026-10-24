// TypeScript's base constraint of `NoUndefined<Output<T>>` is `never`, although the type has values once T is known (zod's `.default(value)`).
// A deferred type whose constraint is `never` says nothing about the values a generic function is given.
type NoUndefined<T> = T extends undefined ? never : T;
interface Schema<Output = unknown> { _output: Output }
type Output<T> = T extends { _output: any } ? T["_output"] : never;
const text: Schema<string> = { _output: "" };
const count: Schema<number | undefined> = { _output: 1 };
const point: Schema<{ x: number }> = { _output: { x: 1 } };

function alone<T extends Schema>(inner: T, value: NoUndefined<Output<T>>): unknown { return value; }
function inUnion<T extends Schema>(inner: T, value: NoUndefined<Output<T>> | number[]): unknown { return value; }
function orUndefined<T extends Schema>(inner: T, value: NoUndefined<Output<T>> | undefined): unknown { return value; }
function optional<T extends Schema>(inner: T, value?: NoUndefined<Output<T>>): unknown { return value; }
function excluded<T extends Schema>(inner: T, value: Exclude<Output<T>, undefined> | number[]): unknown { return value; }
function twice<T extends Schema>(inner: T, value: NoUndefined<NoUndefined<Output<T>>> | null): unknown { return value; }
function intersected<T extends Schema>(inner: T, value: (NoUndefined<Output<T>> & {}) | number[]): unknown { return value; }
function inField<T extends Schema>(inner: T, holder: { held: NoUndefined<Output<T>> | number[] }): unknown { return holder.held; }
function inArray<T extends Schema>(inner: T, values: (NoUndefined<Output<T>> | null)[]): unknown { return values[0]; }
function returned<T extends Schema>(inner: T): NoUndefined<Output<T>> | undefined { return inner._output as NoUndefined<Output<T>>; }
function orFactory<T extends Schema>(inner: T, value: NoUndefined<Output<T>> | (() => NoUndefined<Output<T>>)): unknown { return typeof value === "function" ? (value as () => unknown)() : value; }
class Defaulted<T extends Schema> {
  constructor(public inner: T, public value: NoUndefined<Output<T>> | undefined) {}
  get(): NoUndefined<Output<T>> | undefined { return this.value; }
}

console.log(alone(text, "a"), inUnion(text, "a"), String(inUnion(text, [1])), orUndefined(text, "a"), orUndefined(text, undefined), optional(text, "a"), optional(text));
console.log(excluded(text, "a"), twice(text, "a"), twice(text, null), intersected(text, "a"), inField(text, { held: "a" }), inArray(text, ["a", null]), returned(text));
console.log(inUnion(count, 2), optional(count, 2), excluded(count, 2), new Defaulted(count, 2).get(), new Defaulted(text, "a").get(), new Defaulted(text, undefined).get());
console.log(JSON.stringify([inUnion(point, { x: 2 }), optional(point, { x: 3 }), inField(point, { held: { x: 4 } }), new Defaulted(point, { x: 5 }).get()]));
console.log(orFactory(text, "a"), orFactory(text, () => "made"), orFactory(count, 3), orFactory(count, () => 4));

interface Parser<Out> { parse(value: unknown): Out }
type Infer<S> = S extends Parser<infer Out> ? Out : never;
interface Tool { inputSchema?: Parser<unknown> }
function validate<T extends Tool, Args extends T["inputSchema"] extends infer S ? (S extends Parser<unknown> ? Infer<S> : undefined) : undefined>(tool: T, args: Args): Args {
  return tool.inputSchema ? args : (undefined as Args);
}
const tool = { inputSchema: { parse: (value: unknown) => value as { a: number } } };
console.log(JSON.stringify(validate(tool, { a: 1 })), validate({}, undefined));

type Procedure = (input: number) => number;
interface RouterRecord { [key: string]: Procedure | RouterRecord }
type Decorated<P> = P extends (input: infer I) => infer O ? (input: I) => O : never;
type DecorateRecord<R extends RouterRecord> = { [K in keyof R]: R[K] extends infer V ? (V extends Procedure ? Decorated<V> : V extends RouterRecord ? DecorateRecord<V> : never) : never };
function pick<R extends RouterRecord, K extends keyof R>(record: DecorateRecord<R>, key: K): DecorateRecord<R>[K] { return record[key]; }
function kindOf<R extends RouterRecord, K extends keyof R>(value: DecorateRecord<R>[K]): string { return typeof value; }
const routes = { double: (n: number) => n * 2, nested: { triple: (n: number) => n * 3 } };
console.log(pick<typeof routes, "double">(routes, "double")(2), pick<typeof routes, "nested">(routes, "nested").triple(2), kindOf<typeof routes, "double">(routes.double), kindOf<typeof routes, "nested">(routes.nested));

type Unwrapped<T> = T extends readonly (infer E)[] ? Unwrapped<E> : T;
function innermost<T>(value: T, fallback: Unwrapped<T> | null): unknown { return fallback; }
type Picked<T> = T extends { kind: "text" } ? string : T extends { kind: "count" } ? number : boolean;
function picked<T extends { kind: string }>(tag: T, value: Picked<T> | undefined): unknown { return value; }
console.log(innermost([[1]], 2), innermost("a", "b"), innermost([["x"]], null), picked({ kind: "text" as const }, "t"), picked({ kind: "count" as const }, 3), picked({ kind: "other" }, true));
