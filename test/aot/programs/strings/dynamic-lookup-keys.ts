// A lookup key that was built at run time is a different string object than the equal key in the table.
declare const console: { log(...args: unknown[]): void }
const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789,:|#@"
function text(seed: number, length: number): string { let s = ""; let x = seed * 2654435761 % 4294967296; for (let i = 0; i < length; i++) { x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff; s += alphabet[(x >>> 8) % alphabet.length] } return s }
function again(s: string): string { return s.split("").join("") }
function changed(s: string, at: number): string { return again(s.slice(0, at) + (s[at] === "a" ? "b" : "a") + s.slice(at + 1)) }
let sum = 0
function look(m: Map<string, number>, k: string): number { const first = m.has(k) ? 1 : 0; const v = m.get(k); return first * 1000003 + (v === undefined ? -1 : v) }
function lookSet(s: Set<string>, k: string): number { const first = s.has(k) ? 2 : 0; return first + (s.has(k) ? 1 : 0) }
for (const mixed of [false, true]) {
  const m = new Map<string, number>(), s = new Set<string>()
  if (mixed) { (m as Map<unknown, number>).set(12345, -5); (m as Map<unknown, number>).set(m, -6); (s as Set<unknown>).add(12345); (s as Set<unknown>).add(s) }
  for (let length = 0; length <= 70; length++) for (let seed = 0; seed < 3; seed++) { const k = text(seed + 1, length); m.set(k, length * 10 + seed); s.add(k) }
  let line = ""
  for (let length = 0; length <= 70; length++) {
    const k = text(2, length)
    let hits = look(m, again(k)) % 1000 + lookSet(s, again(k)), misses = 0
    for (let at = 0; at < length; at++) { const other = changed(k, at); misses += (look(m, other) === -1 ? 0 : 1) + lookSet(s, other) }
    line += " " + hits + ":" + misses
  }
  console.log("mixed " + mixed + " size " + m.size + " " + s.size + line)
  const fresh = again(text(2, 33)); m.has(fresh); m.set(fresh, 777); s.has(fresh); s.add(fresh)
  console.log("set over: " + m.size + " " + m.get(text(2, 33)) + " " + s.size)
  const gone = again(text(3, 41)); m.has(gone); s.has(gone)
  console.log("deleted: " + m.delete(gone) + " " + m.delete(gone) + " " + m.size + " " + s.delete(gone) + " " + s.delete(gone) + " " + s.size + " " + m.has(text(3, 41)))
}
for (const mixed of [false, true]) {
  const big = new Map<string, number>()
  if (mixed) (big as Map<unknown, number>).set(0.5, -1)
  for (let i = 0; i < 40000; i++) big.set(text(i, 9 + i % 23), i)
  let hits = 0, misses = 0
  for (let i = 0; i < 40000; i++) { const k = again(text(i, 9 + i % 23)); big.has(k); const v = big.get(k); if (v !== undefined) { hits++; sum = (sum * 31 + v) % 1000003 } }
  for (let i = 40000; i < 120000; i++) { const k = again(text(i, 9 + i % 23)); big.has(k); if (big.get(k) === undefined) misses++ }
  console.log("big, mixed " + mixed + ": size " + big.size + " hits " + hits + " misses " + misses + " sum " + sum)
}
const wide = new Map<string, number>()
for (let length = 1; length <= 20; length++) wide.set("Ж" + text(7, length), length)
let wideLine = ""
for (let length = 1; length <= 20; length++) { const k = again("Ж" + text(7, length)); wide.has(k); wideLine += " " + wide.get(k) + (wide.get(again("З" + text(7, length))) === undefined ? "-" : "!") }
console.log("16 bits:" + wideLine)
