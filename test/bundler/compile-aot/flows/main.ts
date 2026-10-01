// GENERATED. Every type-correct way for an object to flow into a type that does not mention one of its properties.
type Box<T> = { it: T };
function identity<T>(x: T): T { return x; }
interface HasV<T> { get(): T }
class Holder<T> implements HasV<T> { constructor(private x: T) {} get(): T { return this.x; } }
const pick = process.argv.length < 99;
const say = (what: string, got: unknown) => console.log(what + ': ' + String(got));
type L0 = { a: number; n0?: string };
type V0 = { a: number; m0?: string };
function makeL0(): L0 { return { a: 0, n0: 'n' }; }
function makeV0(): V0 { return { a: 0, m0: 'm' }; }
function route0(): V0 { const v: V0 = makeL0(); return v; }
function readM0(v: V0): string | undefined { return v.m0; }
function writeM0(v: V0): void { v.m0 = 'w'; }
{ const v = route0(); const before = readM0(v); writeM0(v); say('assignment', before + ' ' + readM0(v) + ' ' + JSON.stringify(v) + ' ' + readM0(makeV0())); }
type L1 = { a: number; n1?: string };
type V1 = { a: number; m1?: string };
function makeL1(): L1 { return { a: 1, n1: 'n' }; }
function makeV1(): V1 { return { a: 1, m1: 'm' }; }
function route1(): V1 { const f = (v: V1): V1 => v; return f(makeL1()); }
function readM1(v: V1): string | undefined { return v.m1; }
function writeM1(v: V1): void { v.m1 = 'w'; }
{ const v = route1(); const before = readM1(v); writeM1(v); say('a parameter', before + ' ' + readM1(v) + ' ' + JSON.stringify(v) + ' ' + readM1(makeV1())); }
type L2 = { a: number; n2?: string };
type V2 = { a: number; m2?: string };
function makeL2(): L2 { return { a: 2, n2: 'n' }; }
function makeV2(): V2 { return { a: 2, m2: 'm' }; }
function route2(): V2 { const f = (): V2 => makeL2(); return f(); }
function readM2(v: V2): string | undefined { return v.m2; }
function writeM2(v: V2): void { v.m2 = 'w'; }
{ const v = route2(); const before = readM2(v); writeM2(v); say('a return', before + ' ' + readM2(v) + ' ' + JSON.stringify(v) + ' ' + readM2(makeV2())); }
type L3 = { a: number; n3?: string };
type V3 = { a: number; m3?: string };
function makeL3(): L3 { return { a: 3, n3: 'n' }; }
function makeV3(): V3 { return { a: 3, m3: 'm' }; }
function route3(): V3 { const ls: L3[] = [makeL3()]; const vs: V3[] = ls; return vs[0]!; }
function readM3(v: V3): string | undefined { return v.m3; }
function writeM3(v: V3): void { v.m3 = 'w'; }
{ const v = route3(); const before = readM3(v); writeM3(v); say('an array, covariantly', before + ' ' + readM3(v) + ' ' + JSON.stringify(v) + ' ' + readM3(makeV3())); }
type L4 = { a: number; n4?: string };
type V4 = { a: number; m4?: string };
function makeL4(): L4 { return { a: 4, n4: 'n' }; }
function makeV4(): V4 { return { a: 4, m4: 'm' }; }
function route4(): V4 { const ls: readonly L4[] = [makeL4()]; const vs: readonly V4[] = ls; return vs[0]!; }
function readM4(v: V4): string | undefined { return v.m4; }
function writeM4(v: V4): void { v.m4 = 'w'; }
{ const v = route4(); const before = readM4(v); writeM4(v); say('a readonly array', before + ' ' + readM4(v) + ' ' + JSON.stringify(v) + ' ' + readM4(makeV4())); }
type L5 = { a: number; n5?: string };
type V5 = { a: number; m5?: string };
function makeL5(): L5 { return { a: 5, n5: 'n' }; }
function makeV5(): V5 { return { a: 5, m5: 'm' }; }
function route5(): V5 { const l = identity(makeL5()); const v: V5 = l; return v; }
function readM5(v: V5): string | undefined { return v.m5; }
function writeM5(v: V5): void { v.m5 = 'w'; }
{ const v = route5(); const before = readM5(v); writeM5(v); say('a generic identity', before + ' ' + readM5(v) + ' ' + JSON.stringify(v) + ' ' + readM5(makeV5())); }
type L6 = { a: number; n6?: string };
type V6 = { a: number; m6?: string };
function makeL6(): L6 { return { a: 6, n6: 'n' }; }
function makeV6(): V6 { return { a: 6, m6: 'm' }; }
function route6(): V6 { return identity<V6>(makeL6()); }
function readM6(v: V6): string | undefined { return v.m6; }
function writeM6(v: V6): void { v.m6 = 'w'; }
{ const v = route6(); const before = readM6(v); writeM6(v); say('a generic, said which', before + ' ' + readM6(v) + ' ' + JSON.stringify(v) + ' ' + readM6(makeV6())); }
type L7 = { a: number; n7?: string };
type V7 = { a: number; m7?: string };
function makeL7(): L7 { return { a: 7, n7: 'n' }; }
function makeV7(): V7 { return { a: 7, m7: 'm' }; }
function route7(): V7 { const b: Box<L7> = { it: makeL7() }; const c: Box<V7> = b; return c.it; }
function readM7(v: V7): string | undefined { return v.m7; }
function writeM7(v: V7): void { v.m7 = 'w'; }
{ const v = route7(); const before = readM7(v); writeM7(v); say('a box', before + ' ' + readM7(v) + ' ' + JSON.stringify(v) + ' ' + readM7(makeV7())); }
type L8 = { a: number; n8?: string };
type V8 = { a: number; m8?: string };
function makeL8(): L8 { return { a: 8, n8: 'n' }; }
function makeV8(): V8 { return { a: 8, m8: 'm' }; }
function route8(): V8 { const m = new Map<string, L8>([['k', makeL8()]]); const r: ReadonlyMap<string, V8> = m; return r.get('k')!; }
function readM8(v: V8): string | undefined { return v.m8; }
function writeM8(v: V8): void { v.m8 = 'w'; }
{ const v = route8(); const before = readM8(v); writeM8(v); say('a Map', before + ' ' + readM8(v) + ' ' + JSON.stringify(v) + ' ' + readM8(makeV8())); }
type L9 = { a: number; n9?: string };
type V9 = { a: number; m9?: string };
function makeL9(): L9 { return { a: 9, n9: 'n' }; }
function makeV9(): V9 { return { a: 9, m9: 'm' }; }
function route9(): V9 { const s = new Set<L9>([makeL9()]); const r: ReadonlySet<V9> = s; for (const x of r) return x; throw 0; }
function readM9(v: V9): string | undefined { return v.m9; }
function writeM9(v: V9): void { v.m9 = 'w'; }
{ const v = route9(); const before = readM9(v); writeM9(v); say('a Set', before + ' ' + readM9(v) + ' ' + JSON.stringify(v) + ' ' + readM9(makeV9())); }
type L10 = { a: number; n10?: string };
type V10 = { a: number; m10?: string };
function makeL10(): L10 { return { a: 10, n10: 'n' }; }
function makeV10(): V10 { return { a: 10, m10: 'm' }; }
function route10(): V10 { const takesV = (v: V10): V10 => v; const call = (f: (l: L10) => V10): V10 => f(makeL10()); return call(takesV); }
function readM10(v: V10): string | undefined { return v.m10; }
function writeM10(v: V10): void { v.m10 = 'w'; }
{ const v = route10(); const before = readM10(v); writeM10(v); say("a callback's parameter", before + ' ' + readM10(v) + ' ' + JSON.stringify(v) + ' ' + readM10(makeV10())); }
type L11 = { a: number; n11?: string };
type V11 = { a: number; m11?: string };
function makeL11(): L11 { return { a: 11, n11: 'n' }; }
function makeV11(): V11 { return { a: 11, m11: 'm' }; }
function route11(): V11 { const o: { f(l: L11): V11 } = { f(v: V11): V11 { return v; } }; return o.f(makeL11()); }
function readM11(v: V11): string | undefined { return v.m11; }
function writeM11(v: V11): void { v.m11 = 'w'; }
{ const v = route11(); const before = readM11(v); writeM11(v); say("a method's parameter", before + ' ' + readM11(v) + ' ' + JSON.stringify(v) + ' ' + readM11(makeV11())); }
type L12 = { a: number; n12?: string };
type V12 = { a: number; m12?: string };
function makeL12(): L12 { return { a: 12, n12: 'n' }; }
function makeV12(): V12 { return { a: 12, m12: 'm' }; }
function route12(): V12 { const u: L12 | V12 = pick ? makeL12() : makeV12(); const v: V12 = u; return v; }
function readM12(v: V12): string | undefined { return v.m12; }
function writeM12(v: V12): void { v.m12 = 'w'; }
{ const v = route12(); const before = readM12(v); writeM12(v); say('a union', before + ' ' + readM12(v) + ' ' + JSON.stringify(v) + ' ' + readM12(makeV12())); }
type L13 = { a: number; n13?: string };
type V13 = { a: number; m13?: string };
function makeL13(): L13 { return { a: 13, n13: 'n' }; }
function makeV13(): V13 { return { a: 13, m13: 'm' }; }
function route13(): V13 { const v: V13 = pick ? makeL13() : makeV13(); return v; }
function readM13(v: V13): string | undefined { return v.m13; }
function writeM13(v: V13): void { v.m13 = 'w'; }
{ const v = route13(); const before = readM13(v); writeM13(v); say('a conditional', before + ' ' + readM13(v) + ' ' + JSON.stringify(v) + ' ' + readM13(makeV13())); }
type L14 = { a: number; n14?: string };
type V14 = { a: number; m14?: string };
function makeL14(): L14 { return { a: 14, n14: 'n' }; }
function makeV14(): V14 { return { a: 14, m14: 'm' }; }
function route14(): V14 { const none: V14 | undefined = pick ? undefined : makeV14(); const v: V14 = none ?? makeL14(); return v; }
function readM14(v: V14): string | undefined { return v.m14; }
function writeM14(v: V14): void { v.m14 = 'w'; }
{ const v = route14(); const before = readM14(v); writeM14(v); say('or', before + ' ' + readM14(v) + ' ' + JSON.stringify(v) + ' ' + readM14(makeV14())); }
type L15 = { a: number; n15?: string };
type V15 = { a: number; m15?: string };
function makeL15(): L15 { return { a: 15, n15: 'n' }; }
function makeV15(): V15 { return { a: 15, m15: 'm' }; }
function route15(): V15 { const ls = [makeL15()]; const vs: V15[] = [...ls]; return vs[0]!; }
function readM15(v: V15): string | undefined { return v.m15; }
function writeM15(v: V15): void { v.m15 = 'w'; }
{ const v = route15(); const before = readM15(v); writeM15(v); say('a spread array', before + ' ' + readM15(v) + ' ' + JSON.stringify(v) + ' ' + readM15(makeV15())); }
type L16 = { a: number; n16?: string };
type V16 = { a: number; m16?: string };
function makeL16(): L16 { return { a: 16, n16: 'n' }; }
function makeV16(): V16 { return { a: 16, m16: 'm' }; }
function route16(): V16 { const vs: V16[] = [1].map(() => makeL16()); return vs[0]!; }
function readM16(v: V16): string | undefined { return v.m16; }
function writeM16(v: V16): void { v.m16 = 'w'; }
{ const v = route16(); const before = readM16(v); writeM16(v); say('map', before + ' ' + readM16(v) + ' ' + JSON.stringify(v) + ' ' + readM16(makeV16())); }
type L17 = { a: number; n17?: string };
type V17 = { a: number; m17?: string };
function makeL17(): L17 { return { a: 17, n17: 'n' }; }
function makeV17(): V17 { return { a: 17, m17: 'm' }; }
function route17(): V17 { const vs: V17[] = ([] as V17[]).concat([makeL17()]); return vs[0]!; }
function readM17(v: V17): string | undefined { return v.m17; }
function writeM17(v: V17): void { v.m17 = 'w'; }
{ const v = route17(); const before = readM17(v); writeM17(v); say('concat', before + ' ' + readM17(v) + ' ' + JSON.stringify(v) + ' ' + readM17(makeV17())); }
type L18 = { a: number; n18?: string };
type V18 = { a: number; m18?: string };
function makeL18(): L18 { return { a: 18, n18: 'n' }; }
function makeV18(): V18 { return { a: 18, m18: 'm' }; }
function route18(): V18 { const vs: V18[] = []; vs.push(makeL18()); return vs[0]!; }
function readM18(v: V18): string | undefined { return v.m18; }
function writeM18(v: V18): void { v.m18 = 'w'; }
{ const v = route18(); const before = readM18(v); writeM18(v); say('push', before + ' ' + readM18(v) + ' ' + JSON.stringify(v) + ' ' + readM18(makeV18())); }
type L19 = { a: number; n19?: string };
type V19 = { a: number; m19?: string };
function makeL19(): L19 { return { a: 19, n19: 'n' }; }
function makeV19(): V19 { return { a: 19, m19: 'm' }; }
function route19(): V19 { const vs: V19[] = Array.from([makeL19()]); return vs[0]!; }
function readM19(v: V19): string | undefined { return v.m19; }
function writeM19(v: V19): void { v.m19 = 'w'; }
{ const v = route19(); const before = readM19(v); writeM19(v); say('Array.from', before + ' ' + readM19(v) + ' ' + JSON.stringify(v) + ' ' + readM19(makeV19())); }
type L20 = { a: number; n20?: string };
type V20 = { a: number; m20?: string };
function makeL20(): L20 { return { a: 20, n20: 'n' }; }
function makeV20(): V20 { return { a: 20, m20: 'm' }; }
function route20(): V20 { const r: Record<string, L20> = { k: makeL20() }; const vs: V20[] = Object.values(r); return vs[0]!; }
function readM20(v: V20): string | undefined { return v.m20; }
function writeM20(v: V20): void { v.m20 = 'w'; }
{ const v = route20(); const before = readM20(v); writeM20(v); say('Object.values', before + ' ' + readM20(v) + ' ' + JSON.stringify(v) + ' ' + readM20(makeV20())); }
type L21 = { a: number; n21?: string };
type V21 = { a: number; m21?: string };
function makeL21(): L21 { return { a: 21, n21: 'n' }; }
function makeV21(): V21 { return { a: 21, m21: 'm' }; }
function route21(): V21 { const r: Record<string, L21> = { k: makeL21() }; const q: Record<string, V21> = r; return q['k']!; }
function readM21(v: V21): string | undefined { return v.m21; }
function writeM21(v: V21): void { v.m21 = 'w'; }
{ const v = route21(); const before = readM21(v); writeM21(v); say('a record', before + ' ' + readM21(v) + ' ' + JSON.stringify(v) + ' ' + readM21(makeV21())); }
type L22 = { a: number; n22?: string };
type V22 = { a: number; m22?: string };
function makeL22(): L22 { return { a: 22, n22: 'n' }; }
function makeV22(): V22 { return { a: 22, m22: 'm' }; }
function route22(): V22 { const t: [L22, number] = [makeL22(), 1]; const u: [V22, number] = t; return u[0]; }
function readM22(v: V22): string | undefined { return v.m22; }
function writeM22(v: V22): void { v.m22 = 'w'; }
{ const v = route22(); const before = readM22(v); writeM22(v); say('a tuple', before + ' ' + readM22(v) + ' ' + JSON.stringify(v) + ' ' + readM22(makeV22())); }
type L23 = { a: number; n23?: string };
type V23 = { a: number; m23?: string };
function makeL23(): L23 { return { a: 23, n23: 'n' }; }
function makeV23(): V23 { return { a: 23, m23: 'm' }; }
function route23(): V23 { const { it }: Box<V23> = { it: makeL23() }; return it; }
function readM23(v: V23): string | undefined { return v.m23; }
function writeM23(v: V23): void { v.m23 = 'w'; }
{ const v = route23(); const before = readM23(v); writeM23(v); say('destructuring', before + ' ' + readM23(v) + ' ' + JSON.stringify(v) + ' ' + readM23(makeV23())); }
type L24 = { a: number; n24?: string };
type V24 = { a: number; m24?: string };
function makeL24(): L24 { return { a: 24, n24: 'n' }; }
function makeV24(): V24 { return { a: 24, m24: 'm' }; }
function route24(): V24 { const f = (v: V24 = makeL24()): V24 => v; return f(); }
function readM24(v: V24): string | undefined { return v.m24; }
function writeM24(v: V24): void { v.m24 = 'w'; }
{ const v = route24(); const before = readM24(v); writeM24(v); say('a default', before + ' ' + readM24(v) + ' ' + JSON.stringify(v) + ' ' + readM24(makeV24())); }
type L25 = { a: number; n25?: string };
type V25 = { a: number; m25?: string };
function makeL25(): L25 { return { a: 25, n25: 'n' }; }
function makeV25(): V25 { return { a: 25, m25: 'm' }; }
function route25(): V25 { class C { v: V25; constructor() { this.v = makeL25(); } } return new C().v; }
function readM25(v: V25): string | undefined { return v.m25; }
function writeM25(v: V25): void { v.m25 = 'w'; }
{ const v = route25(); const before = readM25(v); writeM25(v); say('a field of a class', before + ' ' + readM25(v) + ' ' + JSON.stringify(v) + ' ' + readM25(makeV25())); }
type L26 = { a: number; n26?: string };
type V26 = { a: number; m26?: string };
function makeL26(): L26 { return { a: 26, n26: 'n' }; }
function makeV26(): V26 { return { a: 26, m26: 'm' }; }
function route26(): V26 { let v: V26 = makeV26(); const set = () => { v = makeL26(); }; set(); return v; }
function readM26(v: V26): string | undefined { return v.m26; }
function writeM26(v: V26): void { v.m26 = 'w'; }
{ const v = route26(); const before = readM26(v); writeM26(v); say('a closure variable', before + ' ' + readM26(v) + ' ' + JSON.stringify(v) + ' ' + readM26(makeV26())); }
type L27 = { a: number; n27?: string };
type V27 = { a: number; m27?: string };
function makeL27(): L27 { return { a: 27, n27: 'n' }; }
function makeV27(): V27 { return { a: 27, m27: 'm' }; }
function route27(): V27 { function* g(): Generator<V27> { yield makeL27(); } for (const x of g()) return x; throw 0; }
function readM27(v: V27): string | undefined { return v.m27; }
function writeM27(v: V27): void { v.m27 = 'w'; }
{ const v = route27(); const before = readM27(v); writeM27(v); say('a generator', before + ' ' + readM27(v) + ' ' + JSON.stringify(v) + ' ' + readM27(makeV27())); }
type L28 = { a: number; n28?: string };
type V28 = { a: number; m28?: string };
function makeL28(): L28 { return { a: 28, n28: 'n' }; }
function makeV28(): V28 { return { a: 28, m28: 'm' }; }
function route28(): V28 { const o = { get v(): V28 { return makeL28(); } }; return o.v; }
function readM28(v: V28): string | undefined { return v.m28; }
function writeM28(v: V28): void { v.m28 = 'w'; }
{ const v = route28(); const before = readM28(v); writeM28(v); say('a getter', before + ' ' + readM28(v) + ' ' + JSON.stringify(v) + ' ' + readM28(makeV28())); }
type L29 = { a: number; n29?: string };
type V29 = { a: number; m29?: string };
function makeL29(): L29 { return { a: 29, n29: 'n' }; }
function makeV29(): V29 { return { a: 29, m29: 'm' }; }
function route29(): V29 { const ls = [makeL29()]; const v: V29 | undefined = ls.find(() => true); return v!; }
function readM29(v: V29): string | undefined { return v.m29; }
function writeM29(v: V29): void { v.m29 = 'w'; }
{ const v = route29(); const before = readM29(v); writeM29(v); say('find', before + ' ' + readM29(v) + ' ' + JSON.stringify(v) + ' ' + readM29(makeV29())); }
type L30 = { a: number; n30?: string };
type V30 = { a: number; m30?: string };
function makeL30(): L30 { return { a: 30, n30: 'n' }; }
function makeV30(): V30 { return { a: 30, m30: 'm' }; }
function route30(): V30 { return [makeL30()].reduce<V30>((_, x) => x, makeV30()); }
function readM30(v: V30): string | undefined { return v.m30; }
function writeM30(v: V30): void { v.m30 = 'w'; }
{ const v = route30(); const before = readM30(v); writeM30(v); say('reduce', before + ' ' + readM30(v) + ' ' + JSON.stringify(v) + ' ' + readM30(makeV30())); }
type L31 = { a: number; n31?: string };
type V31 = { a: number; m31?: string };
function makeL31(): L31 { return { a: 31, n31: 'n' }; }
function makeV31(): V31 { return { a: 31, m31: 'm' }; }
function route31(): V31 { const i: HasV<V31> = new Holder<L31>(makeL31()); return i.get(); }
function readM31(v: V31): string | undefined { return v.m31; }
function writeM31(v: V31): void { v.m31 = 'w'; }
{ const v = route31(); const before = readM31(v); writeM31(v); say('an interface a class implements', before + ' ' + readM31(v) + ' ' + JSON.stringify(v) + ' ' + readM31(makeV31())); }
type L32 = { a: number; n32?: string };
type V32 = { a: number; m32?: string };
function makeL32(): L32 { return { a: 32, n32: 'n' }; }
function makeV32(): V32 { return { a: 32, m32: 'm' }; }
function route32(): V32 { const l = makeL32() satisfies V32; const v: V32 = l; return v; }
function readM32(v: V32): string | undefined { return v.m32; }
function writeM32(v: V32): void { v.m32 = 'w'; }
{ const v = route32(); const before = readM32(v); writeM32(v); say('satisfies', before + ' ' + readM32(v) + ' ' + JSON.stringify(v) + ' ' + readM32(makeV32())); }
type L33 = { a: number; n33?: string };
type V33 = { a: number; m33?: string };
function makeL33(): L33 { return { a: 33, n33: 'n' }; }
function makeV33(): V33 { return { a: 33, m33: 'm' }; }
function route33(): V33 { const v: V33 = Object.assign(makeL33(), {}); return v; }
function readM33(v: V33): string | undefined { return v.m33; }
function writeM33(v: V33): void { v.m33 = 'w'; }
{ const v = route33(); const before = readM33(v); writeM33(v); say("Object.assign's target", before + ' ' + readM33(v) + ' ' + JSON.stringify(v) + ' ' + readM33(makeV33())); }
type L34 = { a: number; n34?: string };
type V34 = { a: number; m34?: string };
function makeL34(): L34 { return { a: 34, n34: 'n' }; }
function makeV34(): V34 { return { a: 34, m34: 'm' }; }
function route34(): V34 { const v: V34 = structuredClone(makeL34()); return v; }
function readM34(v: V34): string | undefined { return v.m34; }
function writeM34(v: V34): void { v.m34 = 'w'; }
{ const v = route34(); const before = readM34(v); writeM34(v); say('structuredClone', before + ' ' + readM34(v) + ' ' + JSON.stringify(v) + ' ' + readM34(makeV34())); }
type L35 = { a: number; n35?: string };
type V35 = { a: number; m35?: string };
function makeL35(): L35 { return { a: 35, n35: 'n' }; }
function makeV35(): V35 { return { a: 35, m35: 'm' }; }
function route35(): V35 { const v: V35 = { ...makeL35() }; return v; }
function readM35(v: V35): string | undefined { return v.m35; }
function writeM35(v: V35): void { v.m35 = 'w'; }
{ const v = route35(); const before = readM35(v); writeM35(v); say('a copy by spread', before + ' ' + readM35(v) + ' ' + JSON.stringify(v) + ' ' + readM35(makeV35())); }
export {};
