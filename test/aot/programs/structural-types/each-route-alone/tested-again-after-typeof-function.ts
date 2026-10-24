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
  value: (() => number) | Square = () => 1;
}

function change(h: Holder): void {
  h.value = new Square();
}

const h = new Holder();
if (typeof h.value === "function") {
  change(h);
  say(`typeof h.value === "function"`, typeof h.value === "function");
  say(`typeof h.value === "object"`, typeof h.value === "object");
  say(`typeof h.value`, typeof h.value);
}
