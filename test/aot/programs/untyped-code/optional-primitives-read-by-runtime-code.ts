// Objects of the program's own types have numbers and booleans that may be absent, undefined or null. Functions made at run time read them and ask for them with `in`.
interface User { id: number; name: string; ok: boolean; score: number }
interface Loose { fraction?: number; whole?: number; flag?: boolean; orNull: number | null; orUndefined: number | undefined; flagOrNull: boolean | null; name: string }
const make = (i: number): User => ({ id: i, name: "name " + i, ok: true, score: 1.5 });
const patch: Partial<User> = { name: "other", score: 2.5 };
const lines: string[] = [];
const readers: Record<string, (o: unknown) => unknown> = Object.create(null);
const reader = (name: string) => (readers[name] ??= new Function("o", "const v = o." + name + "; return [Object.is(v, -0) ? '-0' : String(v), typeof v, '" + name + "' in o, v === undefined, v === null, v === 1, v == null, v ? 't' : 'f'].join('/');") as (o: unknown) => unknown);
const say = (label: string, names: string[], values: unknown[]) => {
  for (const name of names) {
    let first = "";
    for (let turn = 0; turn < 300; turn++) {
      const seen = values.map(value => reader(name)(value)).join(" ");
      if (!turn) first = seen;
      else if (seen !== first) { lines.push(label + " " + name + " DIFFERS at " + turn + ": " + seen); break; }
    }
    lines.push(label + " " + name + ": " + first);
  }
};
say("users", ["id", "name", "ok", "score"], [make(1), make(2.5), make(-0), make(NaN), make(Infinity), make(4294967296), patch, { ...patch }, {}]);
const loose: Loose[] = [
  { orNull: 1, orUndefined: 1, flagOrNull: true, name: "bare" },
  { fraction: 0.5, whole: 1, flag: true, orNull: null, orUndefined: undefined, flagOrNull: null, name: "full" },
  { fraction: NaN, whole: 0, flag: false, orNull: NaN, orUndefined: -0, flagOrNull: false, name: "edges" },
  { fraction: undefined, whole: undefined, flag: undefined, orNull: 1e300, orUndefined: -1e300, flagOrNull: true, name: "undefined but there" },
];
say("loose", ["fraction", "whole", "flag", "orNull", "orUndefined", "flagOrNull", "name", "missing"], loose);
const changing: Loose = { orNull: 1, orUndefined: 2, flagOrNull: null, name: "changing" };
const steps: Array<() => void> = [
  () => { changing.fraction = 1.25; }, () => { changing.whole = 7; }, () => { changing.flag = false; }, () => { changing.fraction = undefined; }, () => { delete changing.whole; },
  () => { delete changing.flag; }, () => { changing.orNull = null; }, () => { changing.orUndefined = undefined; }, () => { changing.flagOrNull = true; }, () => { changing.whole = 2147483648; }, () => { changing.fraction = -0; },
];
for (const step of steps) {
  step();
  lines.push("changing: " + ["fraction", "whole", "flag", "orNull", "orUndefined", "flagOrNull"].map(name => reader(name)(changing)).join(" "));
}
const sum = new Function("o", "return (o.id ?? 0) + (o.score ?? 0) + (o.ok ? 1 : 0);") as (o: unknown) => number;
let total = 0;
const both = [make(3), patch, make(0.25)];
for (let turn = 0; turn < 150000; turn++) total += sum(both[turn % 3]);
lines.push("sums: " + total);
console.log(lines.join("\n"));
