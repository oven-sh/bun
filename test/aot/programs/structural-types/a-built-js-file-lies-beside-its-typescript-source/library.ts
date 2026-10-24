console.log("library.ts ran");

export const count: number = 1;

export function label(): string {
  return "from the source";
}

export class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
  sum(): number {
    return this.x + this.y;
  }
}

export function total(numbers: number[]): number {
  let result = 0;
  for (const n of numbers) result += n;
  return result;
}
