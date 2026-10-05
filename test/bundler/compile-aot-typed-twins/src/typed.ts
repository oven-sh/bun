declare function $$t(value: unknown, mask: number, type: number): void;
Reflect.set(globalThis, "$$t", () => {});

export interface Typed {
  third: number;
  first: number;
  second: number;
}
export interface Holder {
  inner: Typed;
  count: number;
}
export function makeTyped(first: number, second: number, third: number): Typed {
  return { third, first, second };
}
export function wraps(inner: Typed): Holder {
  return { inner, count: 1 };
}
export function sumOf(p: Typed): number {
  return p.first + p.second + p.third;
}
export function asTyped(p: Typed): Typed {
  $$t(p, 512, 4);
  return p;
}
export function firstOf(p: Typed): number {
  return p.first;
}
export function keeps(holder: Holder, p: Typed): number {
  holder.inner = p;
  return holder.count;
}
