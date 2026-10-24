// One object is used as a tagged union and as an unrelated record type. It stays one object.
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
type Circle = { kind: "circle"; r: number; at: Sub };
type Square = { kind: "square"; side: number; at: Sub };
type Shape = Circle | Square;
interface Placed { at: Sub; label: string }
function area(s: Shape): number {
  s.at.v += 1;
  return s.kind === "circle" ? s.r * s.r * 3 : s.side * s.side;
}
function place(p: Placed): string {
  p.at.v += 1;
  return p.label + p.at.v;
}
const madeCircle: Circle = { kind: "circle", r: 1, at: { v: 0 } };
const madeSquare: Shape = { kind: "square", side: 2, at: { v: 0 } };
const madePlaced: Placed = { at: { v: 0 }, label: "l" };
row("typed code only", () => area(madeCircle) + area(madeSquare) + place(madePlaced));
row("JSON used as a tagged union, then as a record", () => {
  const raw = hide(JSON.parse('{"kind":"square","side":3,"at":{"v":1},"label":"s"}')); return area(raw) + " " + place(raw) + " " + raw.at.v;
});
