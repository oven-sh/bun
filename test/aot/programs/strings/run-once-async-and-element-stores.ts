// Async functions and element stores in code that runs only once.
declare const console: { log(...a: unknown[]): void }
async function p0(): Promise<number> { return 1 }
async function p1(a: number): Promise<number> { return a + 1 }
async function p4(a: number, b: number, c: string, d: number): Promise<string> { return c + (a + b * d) }
async function pd(a: number, b: number): Promise<number> { return a * 1.5 + b / 3 }
async function pThrow(a: number): Promise<number> { if (a >= 0) throw new RangeError("cold " + a); return a }
async function pAwait(a: Promise<number>): Promise<number> { return (await a) + 1 }
function put(a: number[], i: number, v: number): void { a[i | 0] = v }
function putS(a: string[], i: number, v: string): void { a[i | 0] = v }
function putO(a: object[], i: number, v: object): void { a[i | 0] = v }
function putAny(a: any[], i: number, v: any): void { a[i | 0] = v }
function show(a: unknown[]): string { return a.length + ":" + JSON.stringify(a) }
const held: unknown[] = [p0, p1, p4, pd, pThrow, pAwait, put, putS, putO, putAny]
{ const ints = [1, 2, 3] as number[]
  put(ints, 0, 9); console.log("ints[0] = 9", show(ints))
  put(ints, 2, 8); console.log("ints[2] = 8", show(ints))
  put(ints, 3, 7); console.log("ints[3] = 7", show(ints))
  put(ints, 4, 6); console.log("ints[4] = 6", show(ints))
  put(ints, 5, 5); console.log("ints[5] = 5", show(ints))
  put(ints, 6, 4); console.log("ints[6] = 4", show(ints))
  put(ints, 7, 3); console.log("ints[7] = 3", show(ints))
  put(ints, 8, 2); console.log("ints[8] = 2", show(ints))
  put(ints, 9, 1); console.log("ints[9] = 1", show(ints))
  put(ints, 12, 0); console.log("ints[12] = 0", show(ints))
  put(ints, 1, 1.5); console.log("ints[1] = 1.5", show(ints))
  put(ints, 2, NaN); console.log("ints[2] = NaN", show(ints))
  put(ints, 13, -0); console.log("ints[13] = -0", show(ints))
  put(ints, 14, 2147483648); console.log("ints[14] = 2147483648", show(ints))
}
{ const fresh = new Array<number>()
  put(fresh, 0, 1); console.log("fresh[0] = 1", show(fresh))
  put(fresh, 1, 2); console.log("fresh[1] = 2", show(fresh))
  put(fresh, 2, 3); console.log("fresh[2] = 3", show(fresh))
  put(fresh, 3, 4); console.log("fresh[3] = 4", show(fresh))
  put(fresh, 4, 5); console.log("fresh[4] = 5", show(fresh))
  put(fresh, 5, 6); console.log("fresh[5] = 6", show(fresh))
  put(fresh, 6, 7); console.log("fresh[6] = 7", show(fresh))
  put(fresh, 7, 8); console.log("fresh[7] = 8", show(fresh))
  put(fresh, 8, 9); console.log("fresh[8] = 9", show(fresh))
}
{ const doubles = [1.5, 2.5] as number[]
  put(doubles, 0, 3); console.log("doubles[0] = 3", show(doubles))
  put(doubles, 1, 4.25); console.log("doubles[1] = 4.25", show(doubles))
  put(doubles, 2, 5); console.log("doubles[2] = 5", show(doubles))
  put(doubles, 3, 6.5); console.log("doubles[3] = 6.5", show(doubles))
  put(doubles, 4, NaN); console.log("doubles[4] = NaN", show(doubles))
  put(doubles, 5, 7); console.log("doubles[5] = 7", show(doubles))
  put(doubles, 6, -0); console.log("doubles[6] = -0", show(doubles))
  put(doubles, 9, 8.5); console.log("doubles[9] = 8.5", show(doubles))
}
{ const texts = ["a", "b"] as string[]
  putS(texts, 0, "x"); console.log("texts[0] = 'x'", show(texts))
  putS(texts, 2, "y"); console.log("texts[2] = 'y'", show(texts))
  putS(texts, 3, "z"); console.log("texts[3] = 'z'", show(texts))
  putS(texts, 4, "w"); console.log("texts[4] = 'w'", show(texts))
  putS(texts, 5, "v"); console.log("texts[5] = 'v'", show(texts))
  putS(texts, 8, "u"); console.log("texts[8] = 'u'", show(texts))
}
{ const objects = [{}] as object[]
  putO(objects, 0, { k: 1 }); console.log("objects[0] = { k: 1 }", show(objects))
  putO(objects, 1, [1]); console.log("objects[1] = [1]", show(objects))
  putO(objects, 2, { k: 2 }); console.log("objects[2] = { k: 2 }", show(objects))
  putO(objects, 3, { k: 3 }); console.log("objects[3] = { k: 3 }", show(objects))
  putO(objects, 4, { k: 4 }); console.log("objects[4] = { k: 4 }", show(objects))
}
{ const mixed = [1, 2] as any[]
  putAny(mixed, 0, "s"); console.log("mixed[0] = 's'", show(mixed))
  putAny(mixed, 1, 1.5); console.log("mixed[1] = 1.5", show(mixed))
  putAny(mixed, 2, null); console.log("mixed[2] = null", show(mixed))
  putAny(mixed, 3, undefined); console.log("mixed[3] = undefined", show(mixed))
  putAny(mixed, 4, { a: 1 }); console.log("mixed[4] = { a: 1 }", show(mixed))
  putAny(mixed, 5, true); console.log("mixed[5] = true", show(mixed))
}
{ const intsAny = [1, 2] as any[]
  putAny(intsAny, 2, 3); console.log("intsAny[2] = 3", show(intsAny))
  putAny(intsAny, 3, "now a text"); console.log("intsAny[3] = 'now a text'", show(intsAny))
  putAny(intsAny, 4, 5); console.log("intsAny[4] = 5", show(intsAny))
}
{ const holes = [1, , 3] as number[]
  put(holes, 1, 2); console.log("holes[1] = 2", show(holes))
  put(holes, 5, 6); console.log("holes[5] = 6", show(holes))
  put(holes, 4, 5); console.log("holes[4] = 5", show(holes))
}
{ const odd = [1, 2, 3] as number[]
  put(odd, -1, 9); console.log("odd[-1] = 9", show(odd), Object.keys(odd).join())
  put(odd, 40, 8); console.log("odd[40] = 8", show(odd))
  put(odd, 2147483647, 7); console.log("odd[2147483647] = 7", odd.length, odd[2147483647], Object.keys(odd).length)
}
{ const frozen = Object.freeze([1, 2, 3]) as number[]; try { put(frozen, 0, 9); console.log("frozen stored", show(frozen)) } catch (e) { console.log("frozen", String(e)) } try { put(frozen, 3, 9); console.log("frozen grown", show(frozen)) } catch (e) { console.log("frozen", String(e)) } }
{ const sealed = Object.seal([1, 2]) as number[]; put(sealed, 0, 9); console.log("sealed", show(sealed)); try { put(sealed, 2, 9); console.log("sealed grown", show(sealed)) } catch (e) { console.log("sealed", String(e)) } }
{ class Sub extends Array<number> {} const sub = new Sub(); put(sub, 0, 1); put(sub, 1, 2); console.log("sub", sub.length, sub[1], sub instanceof Sub) }
{ const literal = (): number[] => [1, 2, 3]; const one = literal(), two = literal(); put(one, 0, 9); console.log("copy on write", show(one), show(two), show(literal())) }
async function drive(): Promise<void> {
  const out: unknown[] = []
  out.push(await p0(), await p1(0), await p4(0, 2, "t", 1), await pd(0, 0.5), await pAwait(p1(0)))
  try { await pThrow(0) } catch (e) { out.push(String(e)) }
  out.push(await p0(), await p1(1), await p4(1, 2, "t", 2), await pd(1, 1.5), await pAwait(p1(1)))
  out.push(await p0(), await p1(2), await p4(2, 2, "t", 3), await pd(2, 2.5), await pAwait(p1(2)))
  out.push(await p0(), await p1(3), await p4(3, 2, "t", 4), await pd(3, 3.5), await pAwait(p1(3)))
  out.push(await p0(), await p1(4), await p4(4, 2, "t", 5), await pd(4, 4.5), await pAwait(p1(4)))
  out.push(await p0(), await p1(5), await p4(5, 2, "t", 6), await pd(5, 5.5), await pAwait(p1(5)))
  out.push(await p0(), await p1(6), await p4(6, 2, "t", 7), await pd(6, 6.5), await pAwait(p1(6)))
  try { await pThrow(6) } catch (e) { out.push(String(e)) }
  out.push(await p0(), await p1(7), await p4(7, 2, "t", 8), await pd(7, 7.5), await pAwait(p1(7)))
  out.push(await p0(), await p1(8), await p4(8, 2, "t", 9), await pd(8, 8.5), await pAwait(p1(8)))
  out.push(await p0(), await p1(9), await p4(9, 2, "t", 10), await pd(9, 9.5), await pAwait(p1(9)))
  out.push(await p0(), await p1(10), await p4(10, 2, "t", 11), await pd(10, 10.5), await pAwait(p1(10)))
  out.push(await p0(), await p1(11), await p4(11, 2, "t", 12), await pd(11, 11.5), await pAwait(p1(11)))
  out.push(await p0(), await p1(12), await p4(12, 2, "t", 13), await pd(12, 12.5), await pAwait(p1(12)))
  try { await pThrow(12) } catch (e) { out.push(String(e)) }
  out.push(await p0(), await p1(13), await p4(13, 2, "t", 14), await pd(13, 13.5), await pAwait(p1(13)))
  out.push(await p0(), await p1(14), await p4(14, 2, "t", 15), await pd(14, 14.5), await pAwait(p1(14)))
  out.push(await p0(), await p1(15), await p4(15, 2, "t", 16), await pd(15, 15.5), await pAwait(p1(15)))
  out.push(await p0(), await p1(16), await p4(16, 2, "t", 17), await pd(16, 16.5), await pAwait(p1(16)))
  out.push(await p0(), await p1(17), await p4(17, 2, "t", 18), await pd(17, 17.5), await pAwait(p1(17)))
  out.push(await p0(), await p1(18), await p4(18, 2, "t", 19), await pd(18, 18.5), await pAwait(p1(18)))
  try { await pThrow(18) } catch (e) { out.push(String(e)) }
  out.push(await p0(), await p1(19), await p4(19, 2, "t", 20), await pd(19, 19.5), await pAwait(p1(19)))
  out.push(await p0(), await p1(20), await p4(20, 2, "t", 21), await pd(20, 20.5), await pAwait(p1(20)))
  out.push(await p0(), await p1(21), await p4(21, 2, "t", 22), await pd(21, 21.5), await pAwait(p1(21)))
  out.push(await p0(), await p1(22), await p4(22, 2, "t", 23), await pd(22, 22.5), await pAwait(p1(22)))
  out.push(await p0(), await p1(23), await p4(23, 2, "t", 24), await pd(23, 23.5), await pAwait(p1(23)))
  const kept = [p0(), p1(1), pd(1, 2), pAwait(p0())]
  out.push(await kept[3], await kept[2], await kept[1], await kept[0], kept[0] === kept[1], kept[0] instanceof Promise)
  console.log(out.length, JSON.stringify(out))
}
drive().then(() => console.log("done", held.length))
