// An object created as one record type gets extra properties through `any` and is then used as a second record type that declares them. The second record type has a property that holds a Map. It stays one object.
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
interface WithMap { s: Sub; x: number; name: string; all: Map<string, number> }
const withMap: WithMap = { s: { v: 1 }, x: 1, name: "t", all: new Map() };
function useMap(w: WithMap): string {
  seen = w;
  w.x += 1;
  return w.name + w.x + w.all.size;
}
row("map", () => useMap(withMap));
row("map member", () => {
  const o = withName(); o.all = new Map([["a", 1]]); const r = useMap(o); return r + " " + (o === seen) + " " + o.x;
});
