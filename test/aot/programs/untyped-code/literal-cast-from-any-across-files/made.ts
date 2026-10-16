export interface Key { key: number }
export interface Wanted { value: Key; more?: { n: number; extra?: string } }
const untyped = (x: any): any => x;
export function make(): Wanted {
  return untyped({ value: { key: 1 }, more: { n: 1, extra: "e" } }) as Wanted;
}
