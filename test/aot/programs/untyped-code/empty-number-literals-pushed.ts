// Arrays that start as `[]` and are filled with `push`: integers, doubles, booleans, mixed values and strings.
function say(name: string, f: () => unknown) { let r: unknown; try { r = f(); } catch (e) { r = "threw " + (e as Error).name; } console.log(name + ": " + r); }
const T = (v: unknown) => typeof v === "string" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v);
const S = (a: unknown[]) => "[" + Array.from(a, T).join(",") + "]" + a.length;
let junk: unknown[] = [];
function garbage() { for (let i = 0; i < 300; i++) junk.push({ i, s: "g" + i, a: [i, "x" + i] }); if (junk.length > 4000) junk = []; }

enum Color { Red, Green, Blue }
const enum Flag { None = 0, A = 1, B = 2, C = 4 }
const BIRTHS = 200, KEPT = 130;
function ints(n: number): Color[] { const a: Color[] = []; for (let i = 0; i < n; i++) a.push(i); return a; }
function flags(n: number): Flag[] { const a: Flag[] = []; for (let i = 0; i < n; i++) a.push(i & 1 ? Flag.C : Flag.A); return a; }
function wholes(n: number): number[] { const a: number[] = []; for (let i = 0; i < n; i++) a.push(i | 0); return a; }
function doubles(n: number): number[] { const a: number[] = []; for (let i = 0; i < n; i++) a.push(i + 0.5); return a; }
function either(n: number): number[] { const a: number[] = []; for (let i = 0; i < n; i++) a.push(i % 3 ? i : i / 4); return a; }
function texts(n: number): string[] { const a: string[] = []; for (let i = 0; i < n; i++) a.push("t" + i); return a; }
function sum(a: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; }
function size(a: string[]): number { let t = 0; for (let i = 0; i < a.length; i++) t += a[i].length; return t; }

const rooms = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 63, 64, 65, 126, 127, 128, 129, 200, 1000];
const down = rooms.slice().reverse();
const jumps = [0, 1000, 0, 1, 128, 3, 127, 5, 6, 0, 200, 1, 3, 1, 5, 0];

for (const [name, order] of [["up", rooms], ["down", down], ["jumps", jumps]] as [string, number[]][]) {
  say("ints, " + name, () => { let t = 0; for (const n of order) for (let b = 0; b < BIRTHS; b++) t += sum(ints(n)); return t; });
  say("doubles, " + name, () => { let t = 0; for (const n of order) for (let b = 0; b < BIRTHS; b++) t += sum(doubles(n)); return t; });
  say("flags, " + name, () => { let t = 0; for (const n of order) for (let b = 0; b < BIRTHS; b++) t += sum(flags(n)); return t; });
  say("wholes, " + name, () => { let t = 0; for (const n of order) for (let b = 0; b < BIRTHS; b++) t += sum(wholes(n)); return t; });
  say("either, " + name, () => { let t = 0; for (const n of order) for (let b = 0; b < BIRTHS; b++) t += sum(either(n)); return t; });
  say("texts, " + name, () => { let t = 0; for (const n of order) for (let b = 0; b < BIRTHS; b++) t += size(texts(n)); return t; });
}

say("kept arrays stay apart", () => {
  const keptInts: number[][] = [], keptDoubles: number[][] = [], keptTexts: string[][] = [];
  for (const n of jumps) for (let b = 0; b < KEPT; b++) {
    const x = ints(n), y = doubles(n), z = texts(n);
    if (b % 13 === 0) { keptInts.push(x); keptDoubles.push(y); keptTexts.push(z); garbage(); }
  }
  let bad = 0, k = 0;
  for (const n of jumps) for (let b = 0; b < KEPT; b += 13, k++) {
    const x = keptInts[k], y = keptDoubles[k], z = keptTexts[k];
    if (x.length !== n || y.length !== n || z.length !== n) bad++;
    for (let i = 0; i < n; i++) if (x[i] !== i || y[i] !== i + 0.5 || z[i] !== "t" + i) bad++;
  }
  return k + " kept, " + bad + " wrong";
});

say("pushed to behind the birth, one past each room", () => {
  let r = "";
  for (const n of [0, 1, 3, 5, 6, 127, 128]) {
    for (let b = 0; b < KEPT; b++) { ints(n); doubles(n); }
    const x = ints(n), y = doubles(n), x2 = ints(n), y2 = doubles(n);
    for (let i = 0; i < 9; i++) { x.push(-i); y.push(-i - 0.25); }
    r += " " + sum(x) + "," + sum(y) + "," + sum(x2) + "," + sum(y2) + "," + x.length + "," + y2.length;
  }
  return r;
});

say("numbers that are not like the others", () => {
  const a = doubles(2); a.push(NaN); a.push(-0); a.push(Infinity); a.push(-Infinity); a.push(1e300); a.push(5e-324);
  const b = wholes(2); b.push(2147483647); b.push(-2147483648); b.push(2147483648); b.push(-0); b.push(NaN); b.push(0.5);
  const c: number[] = []; c.push(NaN); const d: number[] = []; d.push(-0); const e: number[] = []; e.push(4294967296);
  return S(a) + S(b) + S(c) + S(d) + S(e) + a.indexOf(NaN) + a.includes(NaN) + b.includes(NaN) + c.includes(NaN);
});

say("numbers an enum's type lets in", () => {
  let r = "";
  for (const v of [2147483647, -2147483648, 2147483648, -2147483649, 4294967296, -0, NaN, 0.5, Infinity, 1e300, 5e-324]) {
    const n: number = v;
    const a = ints(2); a.push(n); const b: Color[] = []; b.push(n); const c = flags(1); (c as number[]).push(n); c.push(Flag.B); const d = ints(5); d[2] = n; const e = ints(3);
    r += " " + S(a) + S(b) + S(c) + S(d) + S(e) + sum(a) + a.includes(n) + a.indexOf(n) + b.lastIndexOf(n);
  }
  return r;
});

say("numbers an enum's type lets in, at every room", () => {
  let r = "";
  for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 127, 128]) {
    for (let b = 0; b < KEPT; b++) ints(n);
    const h: number = n + 0.5, a = ints(n), z = ints(n); a.push(h); a.push(1); a.push(h);
    r += " " + sum(a) + "," + a.length + "," + sum(z) + "," + T(a[n]) + T(a[n + 1]) + T(a[n + 3]);
  }
  return r;
});

say("holes", () => {
  const a = doubles(3); a.length = 6; const b = ints(3); b.length = 6; const c: number[] = []; c.push(1.5); c[4] = 2.5; const d: number[] = []; d.push(1); d[4] = 2;
  return S(a) + S(b) + S(c) + S(d) + (3 in a) + (3 in b) + (2 in c) + (2 in d) + JSON.stringify([a, b, c, d]);
});

say("emptied and filled again", () => {
  let r = "";
  for (const f of [ints, flags, wholes, doubles, either] as ((n: number) => number[])[]) { const a = f(7); a.length = 0; a.push(1); a.push(2.5); const p = a.pop(), q = a.shift(), u = a.pop(), v = a.shift(); a.push(9); r += S(a) + T(p) + T(q) + T(u) + T(v); }
  return r;
});

say("a value its type denies", () => {
  const a = doubles(3); (a as unknown as string[]).push("x"); const b = ints(3); (b as unknown as unknown[]).push({ toString() { return "o"; } }); const c: number[] = []; (c as unknown as unknown[]).push(undefined); c.push(1.5);
  const f = flags(3); (f as unknown as unknown[]).push(null); const g: Flag[] = []; (g as unknown as unknown[]).push("g"); g.push(Flag.A);
  const d = doubles(3), e = ints(3), h = flags(3);
  return S(a) + S(b) + S(c) + S(d) + S(e) + S(f) + S(g) + S(h);
});

say("never pushed to on this way", () => {
  function maybe(c: boolean, x: number): number[] { const a: number[] = []; if (c) a.push(x); return a; }
  let t = 0; for (let b = 0; b < 500; b++) { const a = maybe(b % 7 === 0, b + 0.5); t += a.length + sum(a); } return t;
});

say("two sites in one function, a generator, a closure", () => {
  let t = 0;
  for (let b = 0; b < 300; b++) { const x: number[] = [], y: number[] = []; x.push(b); for (let i = 0; i < 20; i++) y.push(i + 0.5); t += sum(x) + sum(y); }
  function* g() { for (let b = 0; b < 200; b++) { const a: number[] = []; a.push(b + 0.5); yield a; a.push(b); } }
  for (const a of g()) t += sum(a);
  const make = () => { const a: number[] = []; return (v: number) => { a.push(v); return a; }; };
  for (let b = 0; b < 200; b++) { const p = make(); p(b); p(b + 0.5); t += sum(p(1)); }
  return t;
});

say("handed to the built-ins", () => {
  const a = doubles(6), b = ints(6), half: number = 0.5;
  return S(a.concat(b)) + S(a.slice(1, 3)) + S(b.map(v => v / 2)) + S(a.filter(v => v > 2)) + S([...a, ...b]) + S(a.reverse()) + S(b.sort((x, y) => y - x)) + S(a.splice(1, 2)) + S(a) + S(b.fill(half, 1, 3)) + a.join() + b.join();
});

say("A BAD TIME", () => { const p = {}; Object.create(p); Object.defineProperty(p, 0, { value: 7, writable: false }); return "from here on"; });
for (const [name, order] of [["up", rooms], ["jumps", jumps]] as [string, number[]][]) {
  say("in a bad time: ints, " + name, () => { let t = 0; for (const n of order) for (let b = 0; b < BIRTHS; b++) t += sum(ints(n)); return t; });
  say("in a bad time: doubles, " + name, () => { let t = 0; for (const n of order) for (let b = 0; b < BIRTHS; b++) t += sum(doubles(n)); return t; });
  say("in a bad time: texts, " + name, () => { let t = 0; for (const n of order) for (let b = 0; b < BIRTHS; b++) t += size(texts(n)); return t; });
}
say("in a bad time: first use of a site", () => { const a: number[] = []; a.push(1.5); const b: Color[] = []; b.push(Color.Green); const c: string[] = []; c.push("c"); a.length = 3; b.length = 3; return S(a) + S(b) + S(c); });
