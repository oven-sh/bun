type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };

function area(shape: Shape): number {
  return shape.kind === "circle" ? shape.radius * shape.radius * 3 : shape.side * shape.side;
}
function retag(shape: Shape): void {
  shape.kind = "square";
}

const shape: Shape = { kind: "circle", radius: 2 };
console.log(area(shape));
retag(shape);
console.log(shape.kind);
console.log(area(shape));
console.log(Object.keys(shape).join());
