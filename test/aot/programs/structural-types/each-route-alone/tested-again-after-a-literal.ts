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
  value: "on" | "off" = "on";
}

function change(h: Holder): void {
  h.value = "off";
}

const h = new Holder();
if (h.value === "on") {
  change(h);
  say(`h.value === "on"`, h.value === "on");
  say(`h.value !== "on"`, h.value !== "on");
  say(`h.value == "on"`, h.value == "on");
}
