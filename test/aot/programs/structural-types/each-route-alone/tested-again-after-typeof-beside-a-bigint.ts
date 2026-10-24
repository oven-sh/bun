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
  value: number | bigint = 1;
}

function change(h: Holder): void {
  h.value = 5n;
}

const h = new Holder();
if (typeof h.value === "number") {
  change(h);
  say(`typeof h.value === "number"`, typeof h.value === "number");
  say(`typeof h.value === "bigint"`, typeof h.value === "bigint");
  say(`typeof h.value`, typeof h.value);
}
