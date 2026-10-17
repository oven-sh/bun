// An object created as one record type comes out of `any` into a second record type that requires a property the object does not have: it goes on as it is, and the property reads undefined as in plain Bun, whether or not the compiler sees through the `any`.
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
interface Point { s: Sub; x: number; y: number }
interface Named { s: Sub; x: number; name: string }
let seen: unknown = null;
function usePoint(p: Point): number {
  seen = p;
  p.x += 1;
  return p.s.v + p.x + p.y;
}
function useNamed(p: Named): string {
  seen = p;
  p.x += 1;
  return p.name + p.x;
}
const point: Point = { s: { v: 1 }, x: 1.5, y: 2.5 };
const named: Named = { s: { v: 1 }, x: 1.5, name: "n" };
function withName(): any {
  const p: Point = { s: { v: 1 }, x: 1.5, y: 2.5 };
  usePoint(p);
  const o: any = hide(p);
  o.name = "n";
  return o;
}
row("typed code only", () => usePoint(point) + " " + useNamed(named));
row("required property is missing", () => {
  const p: Point = { s: { v: 1 }, x: 1.5, y: 2.5 }; const o: any = hide(p); const n: Named = o; return n.name;
});
