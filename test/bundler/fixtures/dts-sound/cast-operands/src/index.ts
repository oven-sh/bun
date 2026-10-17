import * as numbers from "./numbers";
export type Size = bigint & { readonly size: true };
export const unzip: <S extends Iterable<readonly [unknown, unknown]>>(self: S) => S extends Iterable<readonly [infer A, infer B]> ? [A[], B[]] : never = (<A, B>(
  self: Iterable<readonly [A, B]>,
): [A[], B[]] => {
  const pairs = [...self];
  return [pairs.map(pair => pair[0]), pairs.map(pair => pair[1])];
}) as any;
class Base {
  constructor(readonly fields?: object) {}
}
export const tagged = <Tag extends string>(tag: Tag): new <A extends object>(fields: A) => A & { readonly tag: Tag } =>
  class extends Base {
    readonly tag = tag;
  } as any;
export const smaller: (left: Size, right: Size) => Size = numbers.smaller as any;
export const succeed = numbers.succeed as <A>(value: A) => { value: A; readonly exact: true };
export const exact: { value: number; readonly exact: true } = succeed(1);
function reduce<Z>(values: number[], initial: Z, step: (accumulator: Z, value: number) => Z): Z {
  return values.reduce(step, initial);
}
export const each = (values: number[], visit: (value: number) => void): void => reduce(values, void 0 as void, (_, value) => visit(value));
function call<B>(produce: () => B): B {
  return produce();
}
export const nothing: undefined = call(() => undefined);
function sql<Row>(strings: TemplateStringsArray, ...values: unknown[]): Row[] {
  return [strings.join("?"), ...values] as Row[];
}
export function names(table: string): string[] {
  return sql<{ name: string }>`SELECT name FROM ${table}`.map(row => row.name);
}
function identity<T>(this: void, value: T): T {
  return value;
}
export const text = (identity<string>).bind(undefined, "text");
export function* encoded(encode: (value: number) => Generator<void, unknown>): Generator<void, string> {
  const first = (yield* encode(1)) as string;
  let second: string;
  second = (yield* encode(2)) as string;
  return first + second;
}
export function never(): Size {
  return numbers.zero as any;
}
export function pick<A extends boolean>(first: A, again: typeof first = first): A extends true ? "first" : "second" {
  return (first && again ? numbers.first() : numbers.second()) as A extends true ? "first" : "second";
}
