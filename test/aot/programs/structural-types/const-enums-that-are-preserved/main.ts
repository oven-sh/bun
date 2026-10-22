import { Name, Plain, Unit } from "./units.ts";
import * as units from "./units.ts";

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

function inUnits(size: number, unit: Unit): number {
  return size / unit;
}
function whole(unit: Unit): number {
  return unit | 0;
}
function label(name: Name): string {
  return name === Name.Byte ? "bytes" : "kilobytes";
}

attempt("units", () => [Unit.Byte, Unit.Kilo, Unit.Mega, Unit.Giga, Unit.Tera]);
attempt("names", () => [Name.Byte, Name.Kilo, label(Name.Byte), label(Name.Kilo)]);
attempt("a plain enum made of them", () => [Plain.One, Plain.Thousand, Plain.Huge, Plain[1024], Plain[Unit.Tera], Object.keys(Plain)]);
attempt("in units", () => [inUnits(4096, Unit.Kilo), inUnits(1, Unit.Tera), inUnits(3, Unit.Byte)]);
attempt("whole", () => [whole(Unit.Giga), whole(Unit.Tera), whole(Unit.Mega)]);
attempt("the names the module exports", () => Object.keys(units).sort());
attempt("a number that is no unit", () => {
  const n: number = 0;
  const unit: Unit = n;
  return [inUnits(5, unit), inUnits(0, unit), whole(unit)];
});
let warm = 0;
for (let i = 0; i < 2000; i++) warm += inUnits(i, i % 2 ? Unit.Kilo : Unit.Byte) + whole(Unit.Mega);
console.log("2000 rounds", warm);
