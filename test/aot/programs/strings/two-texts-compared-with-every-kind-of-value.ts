// A switch over two texts, the same as two comparisons, and a switch over one text, on parameters typed `string`, `string | undefined` and `unknown`. What arrives: the texts themselves, made at run time by joining and cutting, 16-bit texts that begin alike, the empty text, undefined, null, numbers, booleans, a symbol, a BigInt, objects with toString
const never = Date.now() < 0;
function bySwitch(s: string): number { switch (s) { case "alpha": return 1; case "gamma": return 2; } return 0; }
function byComparisons(s: string): number { if (s === "alpha") return 1; if (s === "gamma") return 2; return 0; }
function optional(s?: string): number { switch (s) { case "alpha": return 1; case "": return 2; } return 0; }
function oneText(s: string | null): number { switch (s) { case "constructor": return 1; } return 0; }
function unknownValue(s: unknown): number { switch (s) { case "alpha": return 1; case "gamma": return 2; } return s === "constructor" ? 3 : 0; }
const parts: string[] = JSON.parse('["al","pha","gam","ma","const","ructor"]');
const long: string = never ? "" : parts.join("") + "紅";
const values: unknown[] = [
  "alpha", "gamma", "constructor", "", "alph", "alphaa", "gamm", "Alpha", parts[0] + parts[1], parts[2] + parts[3], parts[4] + parts[5],
  long.slice(0, 5), long.slice(5, 10), long.slice(10, 21), long.slice(21), ("alpha紅").slice(0, 5), "alphā", undefined, null, 0, 1.5, NaN, true, false,
  Symbol("alpha"), 10n, { toString() { return "alpha"; } }, ["alpha"], new String("alpha"), function alpha() {},
];
for (let round = 0; round < 300; round++) {
  let line = "";
  for (const value of values) {
    const s = value as string;
    line += bySwitch(s) + "" + byComparisons(s) + optional(s) + oneText(s) + unknownValue(value) + " ";
  }
  if (round % 149 === 0) console.log(round, line);
}
