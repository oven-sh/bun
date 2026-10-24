// Two strings are appended to in turn in one loop, a function that builds a string is called while another string is being built, a collection runs between two builders, and a string is read while it grows.
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
function inTurn(n: number): string { let a = "a:"; let b = "b:"; for (let i = 0; i < n; i++) { a += i; b += i * 2; a += ","; b += ";"; } return a + "|" + b; }
function chosenByCondition(n: number): string { let even = ""; let odd = ""; for (let i = 0; i < n; i++) { if (i & 1) odd += i; else even += i; } return even + "/" + odd; }
function swapped(n: number): string { let a = "a"; let b = "b"; for (let i = 0; i < n; i++) { a += i; [a, b] = [b, a]; } return a + "|" + b; }
function oneIntoAnother(n: number): string { let a = ""; let b = ""; for (let i = 0; i < n; i++) { b += i; a += b; a += ";"; } return a; }
function inner(k: number): string { let s = "("; for (let j = 0; j < k; j++) s += j; return s + ")"; }
function nestedCalls(n: number): string { let s = ""; for (let i = 0; i < n; i++) { s += "<"; s += inner(i); s += ">"; } return s; }
function nestedLoops(n: number): string { let s = ""; for (let i = 0; i < n; i++) { let row = ""; for (let j = 0; j <= i; j++) row += j; s += row + "\n"; } return s; }
function recursive(depth: number): string { let s = "["; for (let i = 0; i < 2; i++) { s += depth; if (depth) s += recursive(depth - 1); } return s + "]"; }
function deepRecursion(depth: number): string { let s = "("; for (let i = 0; i < 2; i++) { s += depth; if (i === 0 && depth) s += deepRecursion(depth - 1); } return s + ")"; }
function collectsBetweenBuilders(n: number): string { let s = ""; for (let i = 0; i < n; i++) { s += inner(i); collect(); } return s; }
function readInLoop(n: number): string { let s = ""; let sum = 0; for (let i = 0; i < n; i++) { s += "xy"; sum += s.length; if (s.endsWith("yxy")) sum++; } return s + sum; }
function retainedStates(n: number): string { const states: string[] = []; let s = ""; for (let i = 0; i < n; i++) { s += i; states.push(s); } return states.join("|"); }
function previousState(n: number): string { let s = ""; let previous = ""; for (let i = 0; i < n; i++) { previous = s; s += i; } return previous + "|" + s; }
function prepended(n: number): string { let s = ""; for (let i = 0; i < n; i++) s = i + s; return s; }
function separators(items: string[]): string { let s = ""; for (const item of items) { if (s) s += ", "; s += item; } return s; }
function readBetweenLoops(n: number): string { let s = ""; for (let i = 0; i < n; i++) s += i; const middle = s; for (let i = 0; i < n; i++) s += "-" + i; return middle + "|" + s; }
function neverRead(n: number): number { let s = ""; let count = 0; for (let i = 0; i < n; i++) { s += i; count++; } return count; }
function keys(n: number): string {
  const counts: Record<string, number> = {}; const sums = new Map<string, number>();
  for (let i = 0; i < n; i++) { const key = (i % 3) + ":" + (i % 2); counts[key] = (counts[key] ?? 0) + 1; sums.set(key, (sums.get(key) ?? 0) + i); }
  return JSON.stringify(counts) + " " + [...sums].join(";");
}
for (const n of [0, 1, 5, 40]) {
  console.log(n + " in turn: " + inTurn(n));                       console.log(n + " chosen by a condition: " + chosenByCondition(n));     console.log(n + " swapped: " + swapped(n));
  console.log(n + " one into the other: " + oneIntoAnother(n).length + " " + oneIntoAnother(n).slice(-30));                                  console.log(n + " nested calls: " + nestedCalls(Math.min(n, 6)));
  console.log(n + " nested loops: " + JSON.stringify(nestedLoops(Math.min(n, 6))));                                                          console.log(n + " recursive: " + recursive(Math.min(n, 3)));
  console.log(n + " read in the loop: " + readInLoop(n));          console.log(n + " retained states: " + retainedStates(Math.min(n, 8))); console.log(n + " previous state: " + previousState(n));
  console.log(n + " prepended: " + prepended(n));                  console.log(n + " read between loops: " + readBetweenLoops(n));         console.log(n + " never read: " + neverRead(n));
  console.log(n + " keys: " + keys(n));
  console.log(n + " deep recursion: " + deepRecursion(Math.min(n, 12)));                                                                     console.log(n + " collections between builders: " + collectsBetweenBuilders(Math.min(n, 6)));
}
console.log("separators: " + separators([]) + "|" + separators(["a"]) + "|" + separators(["", "a", "", "b"]) + "|" + separators(["x", "y", "z"]));
