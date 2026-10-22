import type { int32 } from "bun";

export class Cursor {
  line: int32 = 0;
  column: int32 = 4;
  constructor(line: int32) {
    this.line = line;
  }
  lineOf(): int32 {
    return this.line;
  }
  sum(): int32 {
    return (this.line + this.column) | 0;
  }
  plainSum(): number {
    return this.line + this.column;
  }
}

export function uses(v: int32): unknown[] {
  const cursor = new Cursor(v);
  const pair: int32[] = [v, 1];
  return [typeof v, v, v + 1, v * 2, v / 2, v % 2, -v, 1 / v, v | 0, v >>> 0, v >> 1, ~v, v === v, v === 0, v < 1, !v, String(v), cursor.line, cursor.column, pair[0], cursor.plainSum(), Math.floor(v), [10, 20, 30][v]];
}

export function lineOf(cursor: Cursor): int32 {
  return cursor.line;
}

export const table = { uses };
