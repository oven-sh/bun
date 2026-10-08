type FallbackFlags<F extends Flags | undefined> =
  Equals<NonNullableFlag<F>["flags"], {}>    extends   true
    ? Dict<any>
    : NonNullableFlag<F>["flags"];

export type UnPromise<Type extends Promise<unknown>> =
  Type extends Promise<infer Generic>
    ? Generic
    : never;

export type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends
  (<T>() => T extends Y ? 1 : 2)
    ? true
    : false;

export type _Repeat<A extends any, N extends number, L extends List = []> =
  __Repeat<N, A, L> extends infer X
  ? Cast<X, List>
  : never

export type Repeat<A extends any, N extends number, L extends List = []> =
  N extends unknown
  ? L extends unknown
    ? _Repeat<A, N, L>
    : never
  : never

export type Intersect<U1 extends any, U2 extends any> =
  U1 extends unknown
  ? U2 extends unknown
    ? {1: U1, 0: never}[Equals<U1, U2>]
    : never
  : never
