function deeper(n: number, f: () => Error): Error { return n ? deeper(n - 1, f) : f(); }
class Thrower { constructor(public tag: number) {} make(): Error { return deeper(2, () => new RangeError("tag " + this.tag)); } }
const kept: Error[] = [];
for (let round = 0; round < 6; round++) {
  for (let i = 0; i < 400; i++) {
    const local = { run: (k: number) => new Thrower(k).make() };
    kept.push(local.run(round * 400 + i));
    try { (null as any).x; } catch (e: any) { if (i % 50 === 0) kept.push(e); }
    try { new URL("not a URL " + i); } catch (e: any) { if (i % 100 === 0) kept.push(e); }
  }
  Bun.gc(true);
}
Bun.gc(true);
const shape = (e: Error) => String(e.stack).split("\n").slice(0, 6).map(l => l.trim().replace(/\(.*[\\/]/, "(").replace(/at .*[\\/]/, "at ")).join(" | ");
const shapes = new Map<string, number>();
for (const e of kept) { const s = shape(e).replace(/tag \d+/, "tag N").replace(/nonexistent\/\d+/, "nonexistent/N"); shapes.set(s, (shapes.get(s) || 0) + 1); }
for (const [s, n] of [...shapes].sort()) console.log(n, s);
