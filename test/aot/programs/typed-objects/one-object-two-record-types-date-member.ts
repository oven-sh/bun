// An object created as one record type gets extra properties through `any` and is then used as a second record type that declares them. The second record type has a property that holds a Date. It stays one object.
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
interface WithDate { s: Sub; x: number; name: string; at: Date }
const withDate: WithDate = { s: { v: 1 }, x: 1, name: "t", at: new Date(0) };
function useDate(w: WithDate): string {
  seen = w;
  w.x += 1;
  return w.name + w.x + w.at.getTime();
}
row("date", () => useDate(withDate));
row("date member", () => {
  const o = withName(); o.at = new Date(5); const r = useDate(o); return r + " " + (o === seen) + " " + o.x;
});
