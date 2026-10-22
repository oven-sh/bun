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
  value: Square | null = new Square();
}

function change(h: Holder): void {
  h.value = null;
}

const h = new Holder();
if (h.value !== null) {
  change(h);
  say(`h.value === null`, h.value === null);
  say(`h.value !== null`, h.value !== null);
  say(`h.value == null`, h.value == null);
  say(`!h.value`, !h.value);
  say(`h.value?.edge`, h.value?.edge);
  say(`h.value ?? "nothing"`, h.value ?? "nothing");
  say(`typeof h.value`, typeof h.value);
}
