export const enum Level {
  Low = 1,
  Middle = Low * 2,
  High = Middle << 2,
  Minus = -High,
  Text = "text",
}

export const enum Bit {
  None = 0,
  A = 1 << 0,
  B = 1 << 1,
  Both = A | B,
  Top = 1 << 31,
  Wide = 2 ** 31,
  Half = 1 / 2,
}

export function describe(level: Level): string {
  switch (level) {
    case Level.Low:
      return "low";
    case Level.Middle:
      return "middle";
    case Level.High:
      return "high";
    case Level.Minus:
      return "minus";
    case Level.Text:
      return "text";
  }
}
