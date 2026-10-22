function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
}

class Circle extends Shape {
  radius = 5;
}

class Holder {
  value: Square | Circle = new Square();
}

function change(h: Holder): void {
  h.value = new Circle();
}

const h = new Holder();
if ("edge" in h.value) {
  change(h);
  say(`"edge" in h.value`, "edge" in h.value);
  say(`"radius" in h.value`, "radius" in h.value);
  say(`h.value instanceof Square`, h.value instanceof Square);
}
