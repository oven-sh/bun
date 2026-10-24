type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };

function describe(shape: Shape): string {
  if (shape.kind === "circle") return "circle " + shape.radius;
  if (shape.kind === "square") return "square " + shape.side;
  return "neither, undefined: " + (shape === undefined) + ", an object: " + (typeof shape === "object");
}
function rename(target: { kind: string }): void {
  target.kind = "triangle";
}

const shape: Shape = { kind: "circle", radius: 2 };
console.log(describe(shape));
rename(shape);
console.log(describe(shape));
