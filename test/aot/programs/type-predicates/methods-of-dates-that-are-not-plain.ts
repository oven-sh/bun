// The members of Date.prototype are fixed in a compiled program, so a call on a parameter declared as a Date goes to the built-in function. Not where one date has a property of that name, where a class below Date has the method, where another prototype lies above the date, or where the value is a Proxy or no date at all.
const log: string[] = [];
function time(d: Date): number { return d.getTime(); }
function year(d: Date): number { return d.getUTCFullYear(); }
function iso(d: Date): string { return d.toISOString(); }
function json(d: Date): string | null { return d.toJSON(); }
function plus(d: Date): number { return +d; }
function minus(a: Date, b: Date): number { return (a as any) - (b as any); }
function less(a: Date, b: Date): boolean { return a < b; }
function moved(d: Date): number { return d.setUTCDate(d.getUTCDate() + 1); }
function text(d: Date): number { return `${d}`.length > 0 ? 1 : 0; }
function isDate(d: unknown): boolean { return d instanceof Date; }
function tag(d: unknown): string { return Object.prototype.toString.call(d); }
class Shifted extends Date { getTime(): number { log.push("Shifted.getTime"); return super.getTime() + 1000; } valueOf(): number { log.push("Shifted.valueOf"); return 42; } getUTCFullYear(): number { return -1; } }
class Quiet extends Date {}
function own(name: PropertyKey, value: unknown): Date { const d = new Date(86400000); Object.defineProperty(d, name, { value, configurable: true, writable: true }); return d; }
const dates: [string, () => any][] = [
  ["plain", () => new Date(86400000)],
  ["invalid", () => new Date(NaN)],
  ["own getTime", () => own("getTime", () => { log.push("own getTime"); return 7; })],
  ["own valueOf", () => own("valueOf", () => { log.push("own valueOf"); return 8; })],
  ["own toISOString", () => own("toISOString", () => { log.push("own toISOString"); return "own"; })],
  ["own toJSON", () => own("toJSON", () => "own json")],
  ["own toPrimitive", () => own(Symbol.toPrimitive, (hint: string) => { log.push(hint); return 9; })],
  ["own getUTCFullYear", () => own("getUTCFullYear", () => 1)],
  ["own getUTCDate", () => own("getUTCDate", () => 30)],
  ["another name", () => own("label", 1)],
  ["class with methods", () => new Shifted(86400000)],
  ["class with nothing", () => new Quiet(86400000)],
  ["the prototype of a class", () => Object.setPrototypeOf(new Date(86400000), Shifted.prototype)],
  ["no prototype", () => Object.setPrototypeOf(new Date(86400000), null)],
  ["a proxy", () => new Proxy(new Date(86400000), {})],
  ["an object under the prototype", () => Object.create(Date.prototype)],
  ["an object with the methods", () => ({ getTime: () => 1, getUTCFullYear: () => 2, toISOString: () => "3", toJSON: () => "4", valueOf: () => 5, setUTCDate: () => 6, getUTCDate: () => 7 })],
  ["a number", () => 5],
  ["nothing", () => undefined],
];
function attempt(run: () => unknown): string { try { return String(run()); } catch (e) { return (e as Error).name; } }
for (let i = 0; i < 3000; i++) { const d = new Date(i); time(d); year(d); iso(d); json(d); plus(d); minus(d, d); less(d, d); moved(d); text(d); isDate(d); tag(d); }
for (const [label, make] of dates) {
  let line = "";
  for (let round = 0; round < 3; round++) {
    log.length = 0;
    line = [time, year, iso, json, plus, moved, text, isDate, tag].map(f => attempt(() => (f as any)(make()))).join(" ") + " " + attempt(() => minus(make(), new Date(1))) + " " + attempt(() => less(new Date(1), make()));
  }
  console.log(label + ": " + line + " | " + log.join());
}
(Date.prototype as any).ago = function (this: Date) { return 100 - this.getTime(); };
(Date.prototype as any).next = function (this: Date) { return new Date(this.getTime() + 1); };
const kept = Date.prototype.toString;
Date.prototype.toString = function () { return "replaced " + this.getTime(); };
console.log((new Date(1) as any).ago(), (new Date(1) as any).next().getTime(), String(new Date(1)), `${new Date(2)}`, new Date(3) + "", new Date(4).toString());
Date.prototype.toString = kept;
console.log(typeof String(new Date(1)), String(new Date(NaN)));
