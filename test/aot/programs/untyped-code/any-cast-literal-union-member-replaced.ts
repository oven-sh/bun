// A member whose interface type is a union takes another arm of the union than the literal started with.
const untyped = (x: any): any => x;
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };
interface Wanted { shape: Shape; note?: string | number }
function size(shape: Shape): number {
  return shape.kind === "square" ? shape.side : shape.radius;
}
const held = untyped({ shape: { kind: "circle", radius: 2 }, note: "n" }) as Wanted;
console.log(held.shape.kind, size(held.shape), held.note);
held.shape = { kind: "square", side: 3 };
held.note = 4;
console.log(held.shape.kind, size(held.shape), held.note, JSON.stringify(held));
interface Parsed { shape: any; note?: any }
const parsed = JSON.parse('{"shape":1}') as Parsed;
console.log(parsed.shape);
