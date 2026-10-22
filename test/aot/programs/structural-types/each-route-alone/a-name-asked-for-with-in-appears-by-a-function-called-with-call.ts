function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Circle {
  radius = 1;
}

class Square {
  edge = 2;
}

function storesToThis(this: { radius: number; edge?: string }): void {
  this.edge = "added";
}

function edgeOrRadius(s: Circle | Square): string {
  if ("edge" in s) return "edge " + typeof s.edge + " " + String(s.edge);
  return "radius " + s.radius;
}

function change(c: Circle): void {
  storesToThis.call(c);
}

let honest = "";
for (let i = 0; i < 2000; i++) honest = edgeOrRadius(i % 2 === 0 ? new Circle() : new Square());
say("honest rounds", honest);
const circle = new Circle();
say("before", edgeOrRadius(circle));
say("before: in", "edge" in circle);
change(circle);
say("after", edgeOrRadius(circle));
say("after: in", "edge" in circle);
say("after: own", Object.hasOwn(circle, "edge"));
say("after: keys", Object.keys(circle).length);
say("after: radius", circle.radius);
say("a fresh circle", edgeOrRadius(new Circle()));
say("a fresh square", edgeOrRadius(new Square()));
