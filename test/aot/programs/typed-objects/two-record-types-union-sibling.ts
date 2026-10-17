// An object created as one record type gets extra properties through `any` and is then used as a second record type that declares them. The second record type also stands in a union with a record type that nothing untyped reaches. It stays one object.
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
interface Closed { kind: "c"; z: number }
const closed: Closed = { kind: "c", z: 1 };
function either(v: Named | Closed): string {
  return "kind" in v ? "closed" + v.z : v.name + v.x;
}
row("either", () => either(closed) + either(named));
row("union sibling", () => {
  const o = withName(); const r = useNamed(o); return r + " " + (o === seen) + " " + o.x;
});
