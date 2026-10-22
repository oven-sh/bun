export const enum Level {
  Low = 1,
  High = Low * 10,
  Name = "level",
}

export enum Plain {
  A = 1,
  B = A + 1,
}

export const enum Bits {
  One = 1 << 0,
  Top = 1 << 31,
}

export function describe(l: Level): string {
  return l === Level.Low ? "low" : l === Level.High ? "high" : "other " + l;
}
