// A typed function is handed to text that becomes code at run time, and called from there: a parameter of a base class that gets its heirs.
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
abstract class Shape { constructor(public id: number) {} abstract area(): number; }
class Square extends Shape { constructor(id: number, public side: number) { super(id); } area() { return this.side ** 2; } }
class Circle extends Shape { constructor(id: number, public r: number) { super(id); } area() { return this.r * 3; } }
function probe(shapes: Shape[], square: Square): number {
  let sum = square.id + square.side;
  for (const s of shapes) sum += s.area() + s.id;
  return sum;
}
console.log(open(probe)([new Square(1, 2), new Circle(2, 3)], new Square(3, 4)));
