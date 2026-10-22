function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

declare function parseInt(text: string): string;
declare function parseFloat(text: string): { value: number };
declare function isNaN(value: number): number;
declare function String(value: unknown): number;
declare function Number(value: unknown): string;
declare function Boolean(value: unknown): string;
declare const Infinity: string;
declare const NaN: string;
declare const Math: { max(a: number, b: number): string; PI: string; tau: number; floor(n: number): boolean };
declare class Date {
  constructor(ms: number);
  getTime(): string;
  missing(): number;
}

function lengthOf(s: string): number {
  return s.length;
}

function upper(s: string): string {
  return s.toUpperCase();
}

function plusOne(n: number): number {
  return n + 1;
}

show("honest callers", () => [lengthOf("ab"), upper("ab"), plusOne(1)]);
show("parseInt is typed string", () => [parseInt("12"), typeof parseInt("12")]);
show("its length", () => [parseInt("12").length, lengthOf(parseInt("12"))]);
show("followed by a string", () => parseInt("12") + "1");
show("in capitals", () => upper(parseInt("12")));
show("parseFloat is typed as an object", () => [parseFloat("1.5"), parseFloat("1.5").value]);
show("isNaN is typed number", () => [isNaN(1), isNaN(1) + 1, plusOne(isNaN(0 / 0))]);
show("String is typed number", () => [String(5), String(5) + 1, plusOne(String(5)), typeof String(5)]);
show("Number is typed string", () => [Number("5"), Number("5") + "1", lengthOf(Number("5"))]);
show("Number in capitals", () => upper(Number("5")));
show("Boolean is typed string", () => [Boolean(1), Boolean(1) + "!", lengthOf(Boolean(1))]);
show("Infinity is typed string", () => [Infinity, Infinity + "!", lengthOf(Infinity), typeof Infinity]);
show("NaN is typed string", () => [NaN, NaN === NaN, lengthOf(NaN)]);
show("Math.max is typed string", () => [Math.max(1, 2), lengthOf(Math.max(1, 2)), Math.max(1, 2) + "3"]);
show("Math.PI is typed string", () => [typeof Math.PI, lengthOf(Math.PI)]);
show("Math.PI in capitals", () => upper(Math.PI));
show("Math.tau is not there", () => [Math.tau, Math.tau + 1, plusOne(Math.tau)]);
show("Math.floor is typed boolean", () => [Math.floor(1.5), Math.floor(0.5) ? "yes" : "no", Math.floor(1.5) === true]);
show("getTime is typed string", () => [new Date(5).getTime(), lengthOf(new Date(5).getTime()), new Date(5).getTime() + "1"]);
show("a method that is not there", () => new Date(5).missing());

let sum = 0;
for (let i = 0; i < 2000; i++) sum += plusOne(String(i).valueOf() === undefined ? 0 : 1) + lengthOf("ab");
show("2000 rounds", () => sum);
show("honest callers again", () => [lengthOf("ab"), upper("ab"), plusOne(1)]);

export {};
