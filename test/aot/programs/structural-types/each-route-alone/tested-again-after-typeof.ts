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
  value: number | string = 1;
}

function change(h: Holder): void {
  h.value = "text";
}

const h = new Holder();
if (typeof h.value === "number") {
  change(h);
  say(`typeof h.value === "number"`, typeof h.value === "number");
  say(`typeof h.value !== "number"`, typeof h.value !== "number");
  say(`typeof h.value === "string"`, typeof h.value === "string");
  say(`typeof h.value`, typeof h.value);
}
