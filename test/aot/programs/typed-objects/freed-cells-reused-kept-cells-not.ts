// After a collection the cells that died are allocated again and those that are alive stay as they are, whichever of their neighbors died: all, none, runs, every second or third.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
type S1 = { a: number };
type S2 = { a: number; b: number; c: number };
type S3 = { a: number; b: number; c: number; d: number; e: number };
type S4 = { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number };
type S5 = { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number; i: number; j: number; k: number; l: number; m: number };
type S6 = S5 & { n: number; o: number; p: number; q: number; r: number; s: number; t: number; u: number; v: number; w: number };
type Kept = { kind: number; seed: number; value: unknown };

function make(kind: number, seed: number): unknown {
  switch (kind) {
    case 0: return { a: seed } as S1;
    case 1: return { a: seed, b: seed + 1, c: seed + 2 } as S2;
    case 2: return { a: seed, b: 1, c: 2, d: 3, e: seed * 2 } as S3;
    case 3: return { a: seed, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: seed * 3 } as S4;
    case 4: return { a: seed, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7, i: 8, j: 9, k: 10, l: 11, m: seed * 4 } as S5;
    case 5: return { a: seed, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7, i: 8, j: 9, k: 10, l: 11, m: 12, n: 13, o: 14, p: 15, q: 16, r: 17, s: 18, t: 19, u: 20, v: 21, w: seed * 5 } as S6;
    case 6: return "text " + seed;
    case 7: return ["a" + seed, "b"].join("-") + seed;
    case 8: { const list: number[] = []; for (let i = 0; i < seed % 23; i++) list.push(seed + i + 0.5); return list; }
    case 9: { const list: unknown[] = []; for (let i = 0; i < seed % 11; i++) list.push({ a: seed + i } as S1); return list; }
    case 10: return () => seed + 1;
    default: { const table = new Map<string, number>(); for (let i = 0; i < seed % 7; i++) table.set("k" + i, seed + i); return table; }
  }
}

function check(kind: number, seed: number, value: unknown): number {
  switch (kind) {
    case 0: return (value as S1).a - seed;
    case 1: { const v = value as S2; return v.a + v.b + v.c - 3 * seed - 3; }
    case 2: { const v = value as S3; return v.a + v.e - 3 * seed + v.b + v.c + v.d - 6; }
    case 3: { const v = value as S4; return v.a + v.h - 4 * seed + v.g - 6; }
    case 4: { const v = value as S5; return v.a + v.m - 5 * seed + v.l - 11; }
    case 5: { const v = value as S6; return v.a + v.w - 6 * seed + v.v - 21 + v.n - 13; }
    case 6: return value === "text " + seed ? 0 : 1;
    case 7: return value === "a" + seed + "-b" + seed ? 0 : 1;
    case 8: { const v = value as number[]; let bad = v.length - (seed % 23); for (let i = 0; i < v.length; i++) bad += v[i] - seed - i - 0.5; return bad; }
    case 9: { const v = value as S1[]; let bad = v.length - (seed % 11); for (let i = 0; i < v.length; i++) bad += v[i].a - seed - i; return bad; }
    case 10: return (value as () => number)() - seed - 1;
    default: { const v = value as Map<string, number>; let bad = v.size - (seed % 7); for (const [key, number] of v) bad += number - seed - Number(key.slice(1)); return bad; }
  }
}

const patterns: ((index: number) => boolean)[] = [
  () => true,
  () => false,
  index => index % 2 === 0,
  index => index % 3 === 0,
  index => index % 3 !== 0,
  index => index % 64 < 40,
  index => index % 200 >= 3,
  index => index % 1000 < 998,
  index => (index * 2654435761) % 97 < 50,
  index => index % 500 === 499,
];

let kept: Kept[] = [];
let wrong = 0;
let made = 0;
for (let round = 0; round < 30; round++) {
  const pattern = patterns[round % patterns.length];
  const fresh: Kept[] = [];
  for (let kind = 0; kind < 12; kind++) {
    for (let i = 0; i < 2500; i++) {
      const seed = round * 100000 + kind * 5000 + i;
      const value = make(kind, seed);
      made++;
      if (pattern(i)) fresh.push({ kind, seed, value });
    }
  }
  kept = kept.filter((_, index) => patterns[(round + 3) % patterns.length](index)).concat(fresh);
  if (round % 3 === 0) collect(true);
  else collect(false);
  for (const item of kept) wrong += Math.abs(check(item.kind, item.seed, item.value));
  console.log(round, kept.length, wrong, made);
}
