// Object types that overlap pairwise in a ring, with fields of different sizes: a store through one type never touches another field.
interface HasA { a: number }
interface HasB { b: boolean }
interface HasC { c: string }
interface HasD { d: number[] }
interface HasE { e: number }
type AB = { a: number; b: boolean }
type BC = { b: boolean; c: string }
type CD = { c: string; d: number[] }
type DE = { d: number[]; e: number }
type EA = { e: number; a: number }
type ACE = { a: number; c: string; e: number }
type BD = { d: number[]; b: boolean }
type All = { e: number; d: number[]; c: string; b: boolean; a: number }
interface MaybeAll { a?: number; b?: boolean; c?: string; d?: number[]; e?: number }
const ab: AB = { a: 1, b: true }
const bc: BC = { b: false, c: "bc" }
const cd: CD = { c: "cd", d: [3] }
const de: DE = { d: [4], e: 4.5 }
const ea: EA = { e: 5, a: 5.5 }
const ace: ACE = { a: 6, c: "ace", e: 6.5 }
const bd: BD = { d: [7], b: true }
const whole: All = { e: 8, d: [8], c: "all", b: false, a: 8.5 }
const objects: object[] = [ab, bc, cd, de, ea, ace, bd, whole]
const withA: HasA[] = [ab, ea, ace, whole]
const withB: HasB[] = [ab, bc, bd, whole]
const withC: HasC[] = [bc, cd, ace, whole]
const withD: HasD[] = [cd, de, bd, whole]
const withE: HasE[] = [de, ea, ace, whole]
function dump(): string { return objects.map(o => JSON.stringify(o)).join("") }
function getA(h: HasA): number { return h.a }
function getB(h: HasB): boolean { return h.b }
function getC(h: HasC): string { return h.c }
function getD(h: HasD): number[] { return h.d }
function getE(h: HasE): number { return h.e }
function setA(h: HasA, v: number): void { h.a = v }
function setB(h: HasB, v: boolean): void { h.b = v }
function setC(h: HasC, v: string): void { h.c = v }
function setD(h: HasD, v: number[]): void { h.d = v }
function setE(h: HasE, v: number): void { h.e = v }
console.log(dump())
console.log(withA.map(getA).join(), withB.map(getB).join(), withC.map(getC).join(), withD.map(h => getD(h).join("+")).join(), withE.map(getE).join())
withA.forEach((h, i) => setA(h, -i - 0.25)); console.log(dump())
withB.forEach((h, i) => setB(h, i % 2 === 0)); console.log(dump())
withC.forEach((h, i) => setC(h, "c" + i)); console.log(dump())
withD.forEach((h, i) => setD(h, [i, i])); console.log(dump())
withE.forEach((h, i) => setE(h, 2 ** (31 + i))); console.log(dump())

// Pairs of fields through the pair types, on the objects that have both.
function pairAB(p: AB): string { p.a += 1; p.b = !p.b; return p.a + "" + p.b }
function pairEA(p: EA): string { const t = p.e; p.e = p.a; p.a = t; return p.e + "/" + p.a }
function pairCD(p: CD): string { p.d.push(p.c.length); p.c += p.d.length; return p.c }
function pairBD(p: BD): string { p.d = p.b ? [] : [1]; return String(p.d.length) }
console.log([ab, whole].map(pairAB).join(), [ea, ace, whole].map(pairEA).join(), [cd, whole].map(pairCD).join(), [bd, whole].map(pairBD).join())
console.log(dump())

// Every object through one type in which everything is optional.
const maybes: MaybeAll[] = [ab, bc, cd, de, ea, ace, bd, whole, {}]
function digest(m: MaybeAll): string { return [m.a, m.b, m.c, m.d === undefined ? undefined : m.d.length, m.e].map(v => v === undefined ? "-" : String(v)).join("|") + ("a" in m ? "A" : "") + ("e" in m ? "E" : "") }
console.log(maybes.map(digest).join(" ; "))
function complete(m: MaybeAll, n: number): void { m.e ??= n; m.d ??= [n]; m.c ??= "n" + n; m.b ??= n % 2 === 0; m.a ??= n + 0.5 }
maybes.forEach(complete)
console.log(maybes.map(digest).join(" ; "))
console.log(maybes.map(m => Object.keys(m).join("")).join())
console.log(dump())
// A property that an object was not created with can be removed again. (One that it was created with cannot: type-rules/overlapping-object-types.)
const madeWith = ["ab", "bc", "cd", "de", "ea", "ace", "bd", "abcde", ""]
maybes.forEach((m, i) => { if (!madeWith[i].includes("c")) delete m.c; if (!madeWith[i].includes("a")) delete m.a })
for (const m of [cd, bc, ace, whole]) setC(m, "back")
for (const m of [ab, ea, ace, whole]) setA(m, 0)
console.log(maybes.map(m => Object.keys(m).join("")).join(), maybes.map(digest).join(" ; "))

let total = 0
for (let i = 0; i < 4000; i++) {
  const k = i & 3
  total += getA(withA[k]) + (getB(withB[k]) ? 1 : 0) + getC(withC[k]).length + getD(withD[k]).length + getE(withE[k]) % 7
  if (i % 1000 === 0) { setA(withA[k], i); setE(withE[k], i + 0.5) }
}
console.log(total, dump())
