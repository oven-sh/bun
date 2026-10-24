type Circle = { kind: "circle"; r: number };
type Ring = { kind: "ring"; r: number; inner: number };
type Square = { kind: "square"; side: number };
type Shape = Circle | Ring | Square;

function area(s: Shape): number {
  switch (s.kind) {
    case "circle": return s.r * s.r * 3;
    case "ring": return (s.r * s.r - s.inner * s.inner) * 3;
    case "square": return s.side * s.side;
  }
}
function radius(c: Circle): number { return c.r; }
function describe(c: Circle): string { return c.kind + ":" + c.r + ":" + Object.keys(c).join(); }
function isCircle(s: Shape): s is Circle { return s.kind === "circle"; }

const lines: string[] = [];
function show(name: string, ...values: unknown[]) { lines.push(name + ": " + values.join(" ")); }
function often<T>(f: () => T): T { let last = f(); for (let i = 0; i < 3000; i++) last = f(); return last; }

const circle: Circle = { kind: "circle", r: 2 };
const ring: Ring = { kind: "ring", r: 5, inner: 1 };
const square: Square = { kind: "square", side: 3 };
show("as they are", often(() => area(circle)), often(() => area(ring)), often(() => area(square)), often(() => radius(circle)), often(() => describe(circle)));

show("cast", often(() => radius(ring as unknown as Circle)), often(() => describe(ring as unknown as Circle)));
const untyped: any = ring;
show("any", often(() => radius(untyped)), often(() => describe(untyped)));

const circles: Circle[] = [circle];
(circles as Shape[]).push(ring, square);
show("array", often(() => circles.map(radius).join()), often(() => circles.map(describe).join(";")));

class Holder { held: Circle; constructor(held: Circle) { this.held = held; } read(): number { return this.held.r; } }
const holder = new Holder(circle);
show("field", often(() => holder.read()));
(holder as any).held = ring;
show("field, a ring", often(() => holder.read()), often(() => describe(holder.held)));
let current: Circle = circle;
function readCurrent(): number { return current.r; }
show("variable", often(readCurrent));
current = untyped;
show("variable, a ring", often(readCurrent));

const turned: Ring = { kind: "ring", r: 7, inner: 2 };
show("before the turn", often(() => area(turned)), isCircle(turned));
(turned as any).kind = "circle";
show("behind the turn", often(() => area(turned)), isCircle(turned), often(() => (isCircle(turned) ? radius(turned) : -1)), describe(turned as unknown as Circle));
const emptied: Circle = { kind: "circle", r: 4 };
(emptied as any).kind = undefined;
show("no tag", String(often(() => area(emptied))), often(() => radius(emptied)));

const wide: Circle = { ...ring, kind: "circle" };
show("spread", often(() => area(wide)), often(() => radius(wide)), describe(wide));

const parsed = JSON.parse('[{"kind":"circle","r":6},{"kind":"ring","r":6,"inner":3},{"kind":"circle","r":6,"inner":3}]') as Shape[];
show("parsed", often(() => parsed.map(area).join()), often(() => radius(parsed[1] as Circle)), describe(parsed[2] as Circle));

console.log(lines.join("\n"));
