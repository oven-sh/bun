type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number; label: string };

function describe(shape: Shape): string {
  if (shape.kind === "square") return shape.label + " " + shape.side;
  return "round " + shape.radius;
}
function retag(shape: Shape, kind: "circle" | "square"): void {
  shape.kind = kind;
}

const square: Shape = { kind: "square", side: 3, label: "three" };
const circle: Shape = { kind: "circle", radius: 2 };
console.log(describe(square));
console.log(describe(circle));
retag(square, "circle");
retag(circle, "square");
console.log(describe(square));
console.log(describe(circle));
console.log(JSON.stringify(square));
console.log(JSON.stringify(circle));
