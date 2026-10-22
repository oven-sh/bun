function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Circle {
  kind: "circle" = "circle";
  radius = 1;
}

class Square {
  kind: "square" = "square";
  edge = 2;
  corner = 90;
}

type Tagged = { kind: "circle" | "square" };

function make(): Square {
  return { ...new Square() };
}

function area(s: Circle | Square): number {
  return s.kind === "square" ? s.edge * s.edge : s.radius * 3;
}

function describe(s: Circle | Square): string {
  switch (s.kind) {
    case "circle":
      return "circle " + s.radius;
    case "square":
      return "square " + s.edge + " " + s.corner;
  }
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += area(i % 2 === 0 ? new Circle() : new Square());
say("honest rounds", sum);
const odd = make();
say("kind", odd.kind);
say("edge", odd.edge);
say("area", area(odd));
say("described", describe(odd));
say("is a square", odd instanceof Square);
odd.edge = 5;
say("area after a store", area(odd));
