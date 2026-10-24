type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return shape.radius * shape.radius * 3;
    case "square":
      return shape.side * shape.side;
  }
}
function other(shape: Shape): number {
  return shape.kind === "circle" ? shape.radius : shape.side;
}

const triangle: Shape = JSON.parse('{"kind":"triangle","base":2}');
const bare: Shape = JSON.parse('{"radius":2}');
const mixed: Shape = JSON.parse('{"kind":"circle","side":2}');
const circle: Shape = JSON.parse('{"kind":"circle","radius":2}');
console.log(area(circle), other(circle));
console.log(triangle.kind, area(triangle), area(triangle) === undefined, typeof area(triangle), other(triangle));
console.log(bare.kind, area(bare), other(bare));
console.log(mixed.kind, area(mixed), other(mixed));
console.log(triangle.kind === "circle" || triangle.kind === "square");
