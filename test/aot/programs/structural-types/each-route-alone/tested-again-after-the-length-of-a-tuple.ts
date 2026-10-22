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
  value: [number] | [number, number] = [1, 2];
}

function change(h: Holder): void {
  h.value = [9];
}

const h = new Holder();
if (h.value.length === 2) {
  change(h);
  say(`h.value.length === 2`, h.value.length === 2);
  say(`h.value.length > 1`, h.value.length > 1);
  say(`h.value.length`, h.value.length);
  say(`1 in h.value`, 1 in h.value);
}
