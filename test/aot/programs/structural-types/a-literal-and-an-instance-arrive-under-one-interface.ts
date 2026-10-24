// One interface is satisfied by an object literal and by instances of a class; the same typed functions read and write both, by turns.
interface Shape {
  name: string;
  size: number;
  parent: Shape | null;
  area(): number;
}
class Square implements Shape {
  name = "square";
  parent: Shape | null = null;
  constructor(public size: number) {}
  area(): number {
    return this.size * this.size;
  }
}
function literal(size: number): Shape {
  return { name: "literal", size, parent: null, area() { return this.size * 2; } };
}
function grow(shape: Shape, parent: Shape | null): string {
  shape.size += 1;
  shape.name = shape.name + "+";
  shape.parent = parent;
  return shape.name + " " + shape.size + " " + shape.area() + " " + (shape.parent ? shape.parent.name : "none");
}
class Holder {
  shape: Shape;
  constructor(shape: Shape) {
    this.shape = shape;
  }
  swap(next: Shape): Shape {
    const before = this.shape;
    this.shape = next;
    return before;
  }
}
const shapes: Shape[] = [];
for (let index = 0; index < 6; index++) shapes.push(index % 2 ? new Square(index) : literal(index));
let parent: Shape | null = null;
for (const shape of shapes) {
  console.log(grow(shape, parent));
  parent = shape;
}
const holder = new Holder(shapes[0]);
for (const shape of shapes) console.log(holder.swap(shape).name, holder.shape.area(), holder.shape instanceof Square);
