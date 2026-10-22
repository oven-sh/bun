import { Bit, describe, Level } from "./levels.ts";
import { isHigh, kept, Rank, Bit as SameBit } from "./again.ts";
import * as levels from "./levels.ts";
import * as again from "./again.ts";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

function bitsOf(bit: Bit): number {
  return bit | 0;
}

attempt("levels", () => [Level.Low, Level.Middle, Level.High, Level.Minus, Level.Text]);
attempt("by a quoted name", () => [Level["Low"], Level["Text"], Bit["Both"]]);
attempt("bits", () => [Bit.None, Bit.A, Bit.B, Bit.Both, Bit.Top, Bit.Wide, Bit.Half]);
attempt("under another name", () => [Rank.Low, Rank.High, Rank.Text, SameBit.Top, Rank.High === Level.High]);
attempt("described", () => [describe(Level.Low), describe(Level.Minus), describe(Level.Text), describe(Rank.Middle)]);
attempt("kept", () => [kept, kept.map(describe), kept.map(isHigh)]);
attempt("bits of", () => [bitsOf(Bit.Top), bitsOf(Bit.Wide), bitsOf(Bit.Half), bitsOf(Bit.Both)]);
attempt("the names a module exports", () => [Object.keys(levels).sort(), Object.keys(again).sort()]);
attempt("a number outside", () => {
  const n: number = 3;
  const level: Level = n;
  return [level, describe(level), typeof describe(level), isHigh(level)];
});
attempt("a fraction as a bit", () => {
  const n: number = 2.5;
  const bit: Bit = n;
  return [bit, bitsOf(bit), bit === Bit.B, bit & Bit.B];
});
let warm = 0;
for (let i = 0; i < 2000; i++) warm += describe(i % 2 ? Level.Low : Level.High).length + bitsOf(i % 2 ? Bit.A : Bit.Top);
console.log("2000 rounds", warm);
