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
  value: number[] | string = [1, 2];
}

function change(h: Holder): void {
  h.value = "text";
}

const h = new Holder();
if (Array.isArray(h.value)) {
  change(h);
  say(`Array.isArray(h.value)`, Array.isArray(h.value));
  say(`typeof h.value === "object"`, typeof h.value === "object");
  say(`typeof h.value`, typeof h.value);
}
