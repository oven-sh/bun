// A string built with += in a loop and read in the same function. The sizes are such that a run that makes the string anew at every read does not end within any time limit: 300,000 turns are a fraction of a second where it is made once.
const out: string[] = [];
function builtThenRead(n: number): number { let result = ""; for (let i = 0; i < n; i++) { result += i * 7919; result += "."; } let sum = 0; for (let i = 0; i < result.length; i++) sum = (sum * 31 + result.charCodeAt(i)) | 0; return sum; }
function builtThenReadBackwards(n: number): number { let s = "<"; for (let i = 0; i < n; i++) s += i & 7; let sum = 0; for (let i = s.length - 1; i >= 0; i--) sum = (sum * 33 + s.charCodeAt(i)) | 0; return sum; }
function builtThenSearched(n: number): number { let s = ""; for (let i = 0; i < n; i++) { s += i; s += ","; } let found = 0; for (let i = 0; i < 2000; i++) if (s.indexOf("," + (n - 1 - i) + ",") >= 0) found++; return found; }
function builtThenSliced(n: number): number { let s = ""; for (let i = 0; i < n; i++) { s += i % 10; } let sum = 0; for (let i = 0; i + 4 <= s.length; i += 4) sum = (sum + Number(s.slice(i, i + 4))) | 0; return sum; }
function builtThenCompared(n: number): number { let s = ""; for (let i = 0; i < n; i++) s += "ab"; let same = 0; for (let i = 0; i < n; i++) if (s === "abab" || s.length === 2 * n) same++; return same; }
function builtThenHandedOn(n: number, take: (s: string) => number): number { let s = ""; for (let i = 0; i < n; i++) { s += i; s += ";"; } let sum = 0; for (let i = 0; i < 1000; i++) sum += take(s); return sum; }
function readWhileBuilt(n: number): number { let s = ""; let sum = 0; for (let i = 0; i < n; i++) { s += i; if ((i & 1023) === 0) sum = (sum + s.charCodeAt(s.length - 1) + s.charCodeAt(0)) | 0; } return sum + s.length; }
function readAtEveryTurn(n: number): number { let s = ""; let sum = 0; for (let i = 0; i < n; i++) { s += i % 10; sum = (sum + s.charCodeAt(i)) | 0; } return sum; }
function builtOnAfterReading(n: number): string { let s = ""; for (let i = 0; i < n; i++) s += i; const first = s.charCodeAt(1); const before = s; for (let i = 0; i < n; i++) s += "-"; return first + " " + before.length + " " + s.length + " " + s.charCodeAt(before.length) + " " + before.charCodeAt(before.length - 1) + " " + (before === s) + " " + s.startsWith(before); }
function twoBuilders(n: number): number { let a = ""; let b = ""; for (let i = 0; i < n; i++) { a += i; b += n - i; } let sum = 0; for (let i = 0; i < a.length && i < b.length; i++) sum = (sum * 7 + a.charCodeAt(i) - b.charCodeAt(i)) | 0; return sum; }
function sometimesEmpty(n: number): number { let s = ""; for (let i = 0; i < n; i++) s += i; let sum = 0; for (let i = 0; i < 10; i++) sum += s.length ? s.charCodeAt(0) : -1; return sum; }
function wide(n: number): number { let s = ""; for (let i = 0; i < n; i++) { s += i; s += "ā"; } let sum = 0; for (let i = 0; i < s.length; i++) sum = (sum * 31 + s.charCodeAt(i)) | 0; return sum; }
function inBranches(n: number, which: boolean): number { let s = ""; for (let i = 0; i < n; i++) s += i; let sum = 0; if (which) { for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i); } else { for (let i = 0; i < s.length; i += 2) sum -= s.charCodeAt(i); } return sum + s.length; }
for (const n of [0, 1, 2, 7, 40, 1000, 300000]) {
    out.push([n, builtThenRead(n), builtThenReadBackwards(n), builtThenSliced(n), builtThenCompared(n), readWhileBuilt(n), twoBuilders(n), sometimesEmpty(n), wide(n), inBranches(n, true), inBranches(n, false)].join(" "));
}
for (const n of [0, 1, 50, 20000]) out.push([n, builtThenSearched(n), builtThenHandedOn(n, s => s.length + (s.length ? s.charCodeAt(s.length >> 1) : 0)), readAtEveryTurn(n), builtOnAfterReading(n)].join(" "));
console.log(out.join("\n"));
