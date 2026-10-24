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
  value: 0 | 1 | 2 = 1;
}

function change(h: Holder): void {
  h.value = 0;
}

const h = new Holder();
if (h.value) {
  change(h);
  say(`h.value ? "truthy" : "falsy"`, h.value ? "truthy" : "falsy");
  say(`!h.value`, !h.value);
  say(`h.value === 1 || h.value === 2`, h.value === 1 || h.value === 2);
  say(`h.value`, h.value);
}
