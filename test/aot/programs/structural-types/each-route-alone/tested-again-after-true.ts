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
  value: boolean = true;
}

function change(h: Holder): void {
  h.value = false;
}

const h = new Holder();
if (h.value) {
  change(h);
  say(`h.value ? "yes" : "no"`, h.value ? "yes" : "no");
  say(`!h.value`, !h.value);
  say(`h.value === true`, h.value === true);
  say(`h.value`, h.value);
}
