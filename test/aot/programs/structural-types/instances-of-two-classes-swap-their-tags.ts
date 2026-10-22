class Circle {
  kind: "circle" = "circle";
  radius = 2;
  size(): number {
    return this.radius * 3;
  }
}
class Square {
  kind: "square" = "square";
  side = 5;
  label = "five";
  size(): number {
    return this.side * this.side;
  }
}
type Shape = Circle | Square;

function measure(shape: Shape): number {
  return shape.kind === "circle" ? shape.radius : shape.side;
}
function labelOf(shape: Shape): string {
  return shape.kind === "square" ? shape.label : "none";
}
function retag(shape: Shape, kind: Shape["kind"]): void {
  shape.kind = kind;
}

const circle = new Circle();
const square = new Square();
const shapes: Shape[] = [circle, square];
let warm = 0;
for (let i = 0; i < 2000; i++) warm += measure(shapes[i % 2]) + labelOf(shapes[i % 2]).length + shapes[i % 2].size();
console.log(warm);
retag(circle, "square");
retag(square, "circle");
console.log(circle.kind, square.kind);
console.log(measure(circle), measure(square));
console.log(labelOf(circle), labelOf(square));
console.log(circle.size(), square.size());
console.log(shapes.map(measure).join(), shapes.map(labelOf).join(), shapes.map(shape => shape.size()).join());
console.log(circle instanceof Circle, square instanceof Square);
console.log(JSON.stringify(shapes));
