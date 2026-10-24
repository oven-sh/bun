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
  value: Square | undefined = new Square();
}

function change(h: Holder): void {
  h.value = undefined;
}

const h = new Holder();
if (h.value !== undefined) {
  change(h);
  say(`h.value === undefined`, h.value === undefined);
  say(`typeof h.value === "undefined"`, typeof h.value === "undefined");
  say(`h.value?.edge`, h.value?.edge);
  say(`h.value ?? "nothing"`, h.value ?? "nothing");
}
