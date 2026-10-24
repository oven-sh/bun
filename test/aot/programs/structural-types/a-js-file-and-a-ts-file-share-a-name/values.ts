export const count: number = 1;
export const name: string = "typescript";
export function double(n: number): number {
  return n * 2;
}
export class Box {
  value = 1;
  get(): number {
    return this.value;
  }
}
export const origin = "values.ts";
