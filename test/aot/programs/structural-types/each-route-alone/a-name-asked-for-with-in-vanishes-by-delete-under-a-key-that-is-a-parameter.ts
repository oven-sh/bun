function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Circle {
  radius = 1;
}

class Square {
  edge = 2;
  corner = 90;
}

function edgeOrRadius(s: Circle | Square): string {
  if ("edge" in s) return "edge " + typeof s.edge + " " + String(s.edge) + " " + s.corner;
  return "radius " + typeof s.radius + " " + String(s.radius);
}

function change(s: Square): void {
  const remove = (o: { edge?: number; other?: number }, key: "edge" | "other"): void => {
    delete o[key];
  };
  remove(s, "edge");
}

let honest = "";
for (let i = 0; i < 2000; i++) honest = edgeOrRadius(i % 2 === 0 ? new Circle() : new Square());
say("honest rounds", honest);
const square = new Square();
say("before", edgeOrRadius(square));
if ("edge" in square) {
  change(square);
  say("edge", square.edge);
  say("edge doubled", square.edge * 2);
  say("in", "edge" in square);
}
say("after", edgeOrRadius(square));
say("after: own", Object.hasOwn(square, "edge"));
say("after: keys", Object.keys(square).join());
say("after: corner", square.corner);
square.edge = 5;
say("stored again", edgeOrRadius(square));
say("stored again: keys", Object.keys(square).join());
say("a fresh square", edgeOrRadius(new Square()));
