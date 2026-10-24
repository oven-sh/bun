// A record with more optional fields than a cell has room for keeps the later ones out of line, references among them in 32 bits. What a local alone holds, read from such a field that is then overwritten, must outlive a collection: to be read, to be stored into another record, to be compared.
// The functions are called through a table, so that nothing is inlined and no object is dissolved. The program asks for its collections itself and fills the freed cells anew.
type Leaf = { n: number; m: number };
interface Wide {
  id: number
  a0?: number; a1?: string; a2?: Wide; a3?: boolean; a4?: number; a5?: string; a6?: Wide; a7?: boolean
  b0?: number; b1?: string; b2?: Wide; b3?: boolean; b4?: number; b5?: string; b6?: Wide; b7?: boolean
  c0?: number; c1?: string; c2?: Wide; c3?: boolean; c4?: number; c5?: string; c6?: Wide; c7?: boolean
  d0?: number; d1?: string; d2?: Wide; d3?: boolean; d4?: number; d5?: string; d6?: Wide; d7?: boolean
  e0?: number; e1?: string; e2?: Wide; e3?: boolean; e4?: number; e5?: string; e6?: Leaf; e7?: boolean; e8?: "on" | "off" | "auto"
}
function collect(): void { const g: any = globalThis; if (g.Bun) g.Bun.gc(true); else g.gc() }
function leaf(n: number): Leaf { return { n, m: n * 2 } }
function text(n: number): string { return ["t", n].join("") }
function churn(): number { let s = 0; for (let i = 0; i < 300; i++) s += F.leaf(9000 + i).m + F.text(i).length; return s }
function again(): void { F.collect(); F.churn() }
function wide(n: number): Wide { const w: Wide = { id: n }; w.e6 = F.leaf(n); w.e5 = F.text(n); w.e8 = n & 1 ? "on" : "off"; return w }
function readFar(w: Wide, fresh: Leaf): number { const a = w.e6; w.e6 = fresh; F.again(); return a ? a.n + a.m : -1 }
function copyFar(w: Wide, to: Wide, fresh: Leaf): void { const a = w.e6; w.e6 = fresh; F.again(); to.e6 = a }
function textFar(w: Wide): number { const a = w.e5; w.e5 = "x"; F.again(); return a ? a.length : -1 }
function copyText(w: Wide, to: Wide): void { const a = w.e5; w.e5 = "x"; F.again(); to.e5 = a }
function copyMode(w: Wide, to: Wide): void { const a = w.e8; w.e8 = "auto"; F.again(); to.e8 = a }
function sameFar(w: Wide, other: Wide, fresh: Leaf): boolean { const a = w.e6; w.e6 = fresh; F.again(); other.e6 = F.leaf(5); return a === other.e6 }
function dropped(n: number): number { const a = F.wide(n).e6; F.again(); return a ? a.m : -1 }
const F = { collect, leaf, text, churn, again, wide, readFar, copyFar, textFar, copyText, copyMode, sameFar, dropped };
const lines: string[] = [];
for (let i = 1; i <= 12; i++) {
  const w = F.wide(i * 10), to = F.wide(i * 10 + 1);
  const read = F.readFar(w, F.leaf(1));
  F.copyFar(F.wide(i * 10 + 2), to, F.leaf(2)); F.again();
  const length = F.textFar(F.wide(i * 10 + 3));
  F.copyText(F.wide(i * 10 + 4), to); F.copyMode(F.wide(i * 10 + 5), to); F.again();
  lines.push([read, to.e6!.n, to.e6!.m, length, to.e5, to.e8, F.sameFar(F.wide(i), F.wide(i + 1), F.leaf(3)), F.dropped(i * 10 + 6)].join());
}
console.log(lines.join("\n"));
