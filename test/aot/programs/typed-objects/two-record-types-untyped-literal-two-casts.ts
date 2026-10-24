// One object from outside typed code is used as two record types that each declare some of its properties. It stays one object: a write through either reference is visible through the other.
function row(name: string, f: () => unknown): void {
  try {
    console.log(name + ": " + String(f()));
  } catch (e) {
    console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e)));
  }
}
function hide(v: unknown): any {
  return v;
}
interface Sub { v: number }
interface Left { id: string; n: number; k?: number; sub: Sub | null }
interface Right { id: string; k: number; n?: number; sub: Sub | null }
const madeLeft: Left = { id: "m", n: 0.5, sub: { v: 1 } };
const madeRight: Right = { id: "m", k: 0.5, sub: null };
function left(x: Left): number {
  x.n += 1;
  return x.n;
}
function right(x: Right): number {
  x.k += 1;
  return x.k;
}
row("typed code only", () => left(madeLeft) + right(madeRight));
row("untyped literal cast twice", () => {
  const raw = hide({ id: "s", n: 7, k: 9, sub: null }); const a = raw as Left; const b = raw as Right; a.n += 1; b.k += 1; return raw.n + " " + raw.k + " " + ((a as unknown) === (b as unknown));
});
