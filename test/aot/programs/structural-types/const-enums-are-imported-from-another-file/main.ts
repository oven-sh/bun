import { all, Bits as BitsAgain, Plain as PlainAgain, Renamed } from "./again.ts";
import { Bits, describe, Level, Plain } from "./levels.ts";
import * as levels from "./levels.ts";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

function plusOne(n: number): number {
  return n + 1;
}

function levelNumber(l: Level.Low | Level.High): number {
  return l * 2;
}

attempt("imported", () => [Level.Low, Level.High, Level.Name, Bits.One, Bits.Top, Plain.A, Plain.B]);
attempt("through the namespace", () => [levels.Level.Low, levels.Level.High, levels.Plain.B, levels.Bits.Top]);
attempt("exported again", () => [Renamed.Low, Renamed.High, BitsAgain.Top, PlainAgain.B, all.Level.High, all.Plain.A]);
attempt("used", () => [plusOne(Level.Low), levelNumber(Level.High), describe(Level.Low), describe(Level.High), describe(Level.Name), Level.Name.length, Bits.Top | Bits.One, Bits.Top >>> 0]);
attempt("the plain enum is an object", () => [typeof Plain, Object.keys(Plain), Plain[1], Plain === PlainAgain, Plain === levels.Plain]);
attempt("what the namespace holds", () => Object.keys(levels).sort());
attempt("a number for the const enum", () => {
  const n: number = 5;
  const l: Level = n;
  return describe(l);
});
attempt("in a switch", () => {
  const name = (l: Level): string => {
    switch (l) {
      case Level.Low:
        return "low";
      case Level.High:
        return "high";
      case Level.Name:
        return "name";
    }
  };
  const n: number = 10;
  const forged: Level = n;
  return [name(Level.Low), name(Renamed.High), name(forged)];
});
attempt("as keys", () => {
  const table: Record<Level.Low | Level.High, string> = { [Level.Low]: "l", [Level.High]: "h" };
  return [Object.keys(table), table[Level.High], table[Renamed.Low]];
});
let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(Level.High) + levelNumber(Level.Low) + Plain.B + describe(Level.Low).length;
console.log("2000 rounds", warm);
attempt("the plain enum is stored to through a view", () => {
  const open: { B: number } = Plain;
  open.B = 200;
  const seen: { readonly B: number } = levels.Plain;
  return [Plain.B, PlainAgain.B, levels.Plain.B, seen.B];
});
