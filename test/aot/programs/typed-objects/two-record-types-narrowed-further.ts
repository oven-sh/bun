// An object created as one record type gets extra properties through `any` and is then used as a second record type that declares them. The second record type is narrowed by a type predicate to a record type that nothing untyped reaches. It stays one object.
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
interface Longer extends Named { more: number }
const longer: Longer = { s: { v: 1 }, x: 1, name: "l", more: 2 };
function isLonger(n: Named): n is Longer {
  return "more" in n;
}
function len(n: Named): number {
  return isLonger(n) ? n.more : 0;
}
row("longer", () => len(longer) + len(named));
row("narrowed further", () => {
  const o = withName(); const r = useNamed(o); return r + " " + len(o) + " " + (o === seen) + " " + o.x;
});
