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
}

function retag(o: { kind: "circle" | "square" }): void {
  o.kind = "square";
}

function area(s: Circle | Square): number {
  return s.kind === "square" ? s.edge * s.edge : s.radius * 3;
}

const circle = new Circle();
say("before", area(circle));
retag(circle);
say("after", area(circle));
say("kind", circle.kind);
say("keys", Object.keys(circle).join());
say("a square", area(new Square()));

const s: Circle | Square = circle;
if (s.kind === "circle") say("typed circle", s.radius);
else say("typed never", s);
