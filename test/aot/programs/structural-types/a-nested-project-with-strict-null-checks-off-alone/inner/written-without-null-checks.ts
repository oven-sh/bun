// TypeScript accepts this file under its own tsconfig.json: an empty `return`, a field that nothing fills and a field that is read before it is filled are errors only with `strictNullChecks`.
export function half(n: number): number {
  if (n < 0) return;
  return n / 2;
}

export async function halfLater(n: number): Promise<number> {
  if (n < 0) return;
  return n / 2;
}

export class Point {
  x: number;
  y: number = 2;
}

export class Early {
  y: number;
  seen: string;
  constructor() {
    this.seen = typeof this.y + " " + (this.y + 1);
    this.y = 1;
  }
}
