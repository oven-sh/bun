// { ...o } of a typed object copies every field at once, whatever the size: 1 to 24 number, string and object fields. Collections between the copies make the allocator refill its free list and fall back to the runtime. A copy is a new, unfrozen object that shares only what its fields refer to.
import { edenGC } from "bun:jsc";

interface Leaf { id: number }
interface F1 { n0: number }
interface F2 extends F1 { s1: string }
interface F3 extends F2 { r2: Leaf }
interface F4 extends F3 { n3: number }
interface F5 extends F4 { s4: string }
interface F6 extends F5 { r5: Leaf }
interface F7 extends F6 { n6: number }
interface F8 extends F7 { s7: string }
interface F9 extends F8 { r8: Leaf }
interface F10 extends F9 { n9: number }
interface F11 extends F10 { s10: string }
interface F12 extends F11 { r11: Leaf }
interface F13 extends F12 { n12: number }
interface F14 extends F13 { s13: string }
interface F15 extends F14 { r14: Leaf }
interface F16 extends F15 { n15: number }
interface F17 extends F16 { s16: string }
interface F18 extends F17 { r17: Leaf }
interface F19 extends F18 { n18: number }
interface F20 extends F19 { s19: string }
interface F21 extends F20 { r20: Leaf }
interface F22 extends F21 { n21: number }
interface F23 extends F22 { s22: string }
interface F24 extends F23 { r23: Leaf }

const n = (i: number, field: number): number => i * 32 + field + (field % 2 ? 0.5 : 0);
const s = (i: number, field: number): string => "s" + field + "-" + i;
const r = (i: number, field: number): Leaf => ({ id: i * 32 + field });

function countDifferences(expected: object, actual: object): number {
  const keys = Object.keys(expected);
  let differences = Object.keys(actual).join() === keys.join() ? 0 : 1;
  for (const key of keys) if (!Object.is((expected as any)[key], (actual as any)[key])) differences++;
  return differences;
}

// Every second copy and every source die, so the free list has gaps between the copies that stay.
function check<T extends object>(fields: number, create: (i: number) => T, copy: (o: T) => T): void {
  const retained: T[] = [];
  let differences = 0;
  for (let i = 0; i < 3000; i++) {
    const source = create(i);
    const result = copy(source);
    if (result === source) differences++;
    differences += countDifferences(source, result);
    if (i % 2 === 0) retained.push(result);
    if (i % 250 === 249) edenGC();
  }
  let changed = 0;
  retained.forEach((result, index) => { if (JSON.stringify(result) !== JSON.stringify(create(index * 2))) changed++; });
  console.log(fields, "fields:", differences, "differences,", changed, "changed later,", Object.keys(retained[0]).length, "keys");
}

check(1, (i): F1 => ({ n0: n(i, 0) }), (o: F1): F1 => ({ ...o }));
check(2, (i): F2 => ({ n0: n(i, 0), s1: s(i, 1) }), (o: F2): F2 => ({ ...o }));
check(3, (i): F3 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2) }), (o: F3): F3 => ({ ...o }));
check(4, (i): F4 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3) }), (o: F4): F4 => ({ ...o }));
check(5, (i): F5 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4) }), (o: F5): F5 => ({ ...o }));
check(6, (i): F6 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5) }), (o: F6): F6 => ({ ...o }));
check(7, (i): F7 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5), n6: n(i, 6) }), (o: F7): F7 => ({ ...o }));
check(8, (i): F8 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5), n6: n(i, 6), s7: s(i, 7) }), (o: F8): F8 => ({ ...o }));
check(9, (i): F9 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5), n6: n(i, 6), s7: s(i, 7), r8: r(i, 8) }), (o: F9): F9 => ({ ...o }));
check(10, (i): F10 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5), n6: n(i, 6), s7: s(i, 7), r8: r(i, 8), n9: n(i, 9) }), (o: F10): F10 => ({ ...o }));
check(11, (i): F11 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5), n6: n(i, 6), s7: s(i, 7), r8: r(i, 8), n9: n(i, 9), s10: s(i, 10) }), (o: F11): F11 => ({ ...o }));
check(12, (i): F12 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5), n6: n(i, 6), s7: s(i, 7), r8: r(i, 8), n9: n(i, 9), s10: s(i, 10), r11: r(i, 11) }), (o: F12): F12 => ({ ...o }));
check(13, (i): F13 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5), n6: n(i, 6), s7: s(i, 7), r8: r(i, 8), n9: n(i, 9), s10: s(i, 10), r11: r(i, 11), n12: n(i, 12) }), (o: F13): F13 => ({ ...o }));
check(14, (i): F14 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5), n6: n(i, 6), s7: s(i, 7), r8: r(i, 8), n9: n(i, 9), s10: s(i, 10), r11: r(i, 11), n12: n(i, 12), s13: s(i, 13) }), (o: F14): F14 => ({ ...o }));
check(15, (i): F15 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5), n6: n(i, 6), s7: s(i, 7), r8: r(i, 8), n9: n(i, 9), s10: s(i, 10), r11: r(i, 11), n12: n(i, 12), s13: s(i, 13), r14: r(i, 14) }), (o: F15): F15 => ({ ...o }));
check(16, (i): F16 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5), n6: n(i, 6), s7: s(i, 7), r8: r(i, 8), n9: n(i, 9), s10: s(i, 10), r11: r(i, 11), n12: n(i, 12), s13: s(i, 13), r14: r(i, 14), n15: n(i, 15) }), (o: F16): F16 => ({ ...o }));
check(17, (i): F17 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5), n6: n(i, 6), s7: s(i, 7), r8: r(i, 8), n9: n(i, 9), s10: s(i, 10), r11: r(i, 11), n12: n(i, 12), s13: s(i, 13), r14: r(i, 14), n15: n(i, 15), s16: s(i, 16) }), (o: F17): F17 => ({ ...o }));
check(18, (i): F18 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5), n6: n(i, 6), s7: s(i, 7), r8: r(i, 8), n9: n(i, 9), s10: s(i, 10), r11: r(i, 11), n12: n(i, 12), s13: s(i, 13), r14: r(i, 14), n15: n(i, 15), s16: s(i, 16), r17: r(i, 17) }), (o: F18): F18 => ({ ...o }));
check(19, (i): F19 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5), n6: n(i, 6), s7: s(i, 7), r8: r(i, 8), n9: n(i, 9), s10: s(i, 10), r11: r(i, 11), n12: n(i, 12), s13: s(i, 13), r14: r(i, 14), n15: n(i, 15), s16: s(i, 16), r17: r(i, 17), n18: n(i, 18) }), (o: F19): F19 => ({ ...o }));
check(20, (i): F20 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5), n6: n(i, 6), s7: s(i, 7), r8: r(i, 8), n9: n(i, 9), s10: s(i, 10), r11: r(i, 11), n12: n(i, 12), s13: s(i, 13), r14: r(i, 14), n15: n(i, 15), s16: s(i, 16), r17: r(i, 17), n18: n(i, 18), s19: s(i, 19) }), (o: F20): F20 => ({ ...o }));
check(21, (i): F21 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5), n6: n(i, 6), s7: s(i, 7), r8: r(i, 8), n9: n(i, 9), s10: s(i, 10), r11: r(i, 11), n12: n(i, 12), s13: s(i, 13), r14: r(i, 14), n15: n(i, 15), s16: s(i, 16), r17: r(i, 17), n18: n(i, 18), s19: s(i, 19), r20: r(i, 20) }), (o: F21): F21 => ({ ...o }));
check(22, (i): F22 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5), n6: n(i, 6), s7: s(i, 7), r8: r(i, 8), n9: n(i, 9), s10: s(i, 10), r11: r(i, 11), n12: n(i, 12), s13: s(i, 13), r14: r(i, 14), n15: n(i, 15), s16: s(i, 16), r17: r(i, 17), n18: n(i, 18), s19: s(i, 19), r20: r(i, 20), n21: n(i, 21) }), (o: F22): F22 => ({ ...o }));
check(23, (i): F23 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5), n6: n(i, 6), s7: s(i, 7), r8: r(i, 8), n9: n(i, 9), s10: s(i, 10), r11: r(i, 11), n12: n(i, 12), s13: s(i, 13), r14: r(i, 14), n15: n(i, 15), s16: s(i, 16), r17: r(i, 17), n18: n(i, 18), s19: s(i, 19), r20: r(i, 20), n21: n(i, 21), s22: s(i, 22) }), (o: F23): F23 => ({ ...o }));
check(24, (i): F24 => ({ n0: n(i, 0), s1: s(i, 1), r2: r(i, 2), n3: n(i, 3), s4: s(i, 4), r5: r(i, 5), n6: n(i, 6), s7: s(i, 7), r8: r(i, 8), n9: n(i, 9), s10: s(i, 10), r11: r(i, 11), n12: n(i, 12), s13: s(i, 13), r14: r(i, 14), n15: n(i, 15), s16: s(i, 16), r17: r(i, 17), n18: n(i, 18), s19: s(i, 19), r20: r(i, 20), n21: n(i, 21), s22: s(i, 22), r23: r(i, 23) }), (o: F24): F24 => ({ ...o }));

interface Small { a: number; b: string; c: Leaf }
interface Large { a: number; b: string; c: Leaf; d: number; e: string; f: Leaf; g: number; h: string; i: Leaf; j: number; k: string; l: Leaf; m: number }
interface Sparse { a: number; b?: string; c?: Leaf; d?: number; e?: string; f?: Leaf; g?: number; h?: string }

const createSmall = (i: number): Small => ({ a: n(i, 0), b: s(i, 1), c: r(i, 2) });
const createLarge = (i: number): Large => ({ a: n(i, 0), b: s(i, 1), c: r(i, 2), d: n(i, 3), e: s(i, 4), f: r(i, 5), g: n(i, 6), h: s(i, 7), i: r(i, 8), j: n(i, 9), k: s(i, 10), l: r(i, 11), m: n(i, 12) });
const copySmall = (o: Small): Small => ({ ...o });
const copyLarge = (o: Large): Large => ({ ...o });
const copySparse = (o: Sparse): Sparse => ({ ...o });
const changeSmall = (o: Small, i: number): void => { o.a = n(i, 20); o.b = s(i, 21); o.c = r(i, 22); };
const changeLarge = (o: Large, i: number): void => { o.a = n(i, 20); o.b = s(i, 21); o.f = r(i, 22); o.g = n(i, 23); o.k = s(i, 24); o.l = r(i, 25); o.m = n(i, 26); };

// A store to a frozen object throws here, so a copy that is still frozen ends the program.
function checkIndependence<T extends object>(name: string, freezesSource: boolean, create: (i: number) => T, copy: (o: T) => T, change: (o: T, i: number) => void): void {
  let wrong = 0;
  for (let i = 0; i < 1000; i++) {
    const source = create(i);
    if (freezesSource) Object.freeze(source);
    const result = copy(source);
    if (Object.isFrozen(result) || Object.isSealed(result) || !Object.isExtensible(result)) wrong++;
    change(result, i);
    (result as any).added = i;
    const expected = create(i);
    if (JSON.stringify(source) !== JSON.stringify(expected) || Object.isFrozen(source) !== freezesSource) wrong++;
    change(expected, i);
    (expected as any).added = i;
    if (JSON.stringify(result) !== JSON.stringify(expected)) wrong++;
    if (i % 250 === 249) edenGC();
  }
  console.log(name, freezesSource ? "copy of a frozen source:" : "copy that is changed:", wrong, "wrong");
}

checkIndependence("small", false, createSmall, copySmall, changeSmall);
checkIndependence("large", false, createLarge, copyLarge, changeLarge);
checkIndependence("small", true, createSmall, copySmall, changeSmall);
checkIndependence("large", true, createLarge, copyLarge, changeLarge);

function checkAddedProperties<T extends object>(name: string, create: (i: number) => T, copy: (o: T) => T): void {
  let wrong = 0;
  let keys = "";
  for (let i = 0; i < 1000; i++) {
    const source = create(i);
    (source as any).extra = s(i, 30);
    (source as any).more = r(i, 31);
    const result = copy(source);
    wrong += countDifferences(source, result);
    keys = Object.keys(result).join();
    if (i % 250 === 249) edenGC();
  }
  console.log(name, "source with added properties:", wrong, "wrong,", keys);
}

checkAddedProperties("small", createSmall, copySmall);
checkAddedProperties("large", createLarge, copyLarge);

function checkFieldsStoredLater(): void {
  let wrong = 0;
  let keys = "";
  for (let i = 0; i < 1000; i++) {
    const source: Sparse = { a: n(i, 0) };
    wrong += countDifferences(source, copySparse(source));
    source.h = s(i, 7);
    wrong += countDifferences(source, copySparse(source));
    source.c = r(i, 2);
    source.d = n(i, 3);
    wrong += countDifferences(source, copySparse(source));
    source.b = s(i, 1);
    source.e = s(i, 4);
    source.f = r(i, 5);
    source.g = n(i, 6);
    const result = copySparse(source);
    wrong += countDifferences(source, result);
    keys = Object.keys(result).join();
    if (i % 250 === 249) edenGC();
  }
  console.log("source with fields stored later:", wrong, "wrong,", keys);
}

checkFieldsStoredLater();
