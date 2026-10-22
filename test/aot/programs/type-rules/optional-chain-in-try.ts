// The read at the end of an optional chain is held to its type. The chain as a whole may yield undefined, also in a try, where every operation that may throw ends a block.
declare const console: { log(...values: unknown[]): void };
class Inner { id: number; constructor(id: number) { this.id = id; } }
interface Outer { inner: Inner | null; list: number[] | null; call: (() => number) | null }
function hide(v: unknown): any { return v; }
const outside: Inner = hide({ id: 5 });
function inATry(p: Outer): string {
  try { return [p.inner?.id, p.inner?.id ?? -1, p.list?.[0], p.list?.length, p.call?.()].join(); } catch (e) { return "caught " + (e as Error).name + ": " + (e as Error).message.replace(/ \(bun compile[^]*$/, ""); }
}
function outsideOfOne(p: Outer): string { return [p.inner?.id, p.inner?.id ?? -1, p.list?.[0], p.list?.length, p.call?.()].join(); }
function kept(p: Outer): unknown { try { const id = p.inner?.id; return id; } catch (e) { return "caught " + (e as Error).name; } }
function inAFinally(p: Outer): unknown { try { return 0; } finally { console.log("finally", p.inner?.id); } }
for (const p of [{ inner: null, list: null, call: null }, { inner: new Inner(1), list: [7], call: () => 3 }, { inner: outside, list: [], call: null }] as Outer[]) {
  console.log(inATry(p)); console.log(outsideOfOne(p)); console.log(kept(p)); inAFinally(p);
}
