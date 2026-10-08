type Tail<T extends any[]> = T extends [infer U, ...infer R] ? R : never;

// should remove parens from this, to avoid a type issue with TypeScript 4.0:
type Tail2<T extends any[]> = T extends [infer U, ...(infer R)] ? R : never;

// but not remove parens from this:
type Tail3<T extends any[]> = T extends [infer U, ...(infer R)[]] ? R : never;

type ReduceNextElement<
  T extends readonly unknown[]
> = T extends readonly [infer V, ...infer R] ? [V, R] : never
