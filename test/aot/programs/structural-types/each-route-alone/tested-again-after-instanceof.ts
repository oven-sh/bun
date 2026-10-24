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
  value: Shape = new Square();
}

function change(h: Holder): void {
  h.value = new Circle();
}

const h = new Holder();
if (h.value instanceof Square) {
  change(h);
  say(`h.value instanceof Square`, h.value instanceof Square);
  say(`h.value instanceof Circle`, h.value instanceof Circle);
  say(`"edge" in h.value`, "edge" in h.value);
}
