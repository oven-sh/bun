function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
  corner = 90;
}

class Holder {
  shape: Shape = new Square();
  value: number | string = 1;
  leaf: Square | null = new Square();
  mode: "on" | "off" = "on";
}

function replace(h: Holder): void {
  Object.defineProperty(h, "shape", { get: () => new Shape() });
  Object.defineProperty(h, "value", { get: () => "text" });
  Object.defineProperty(h, "leaf", { get: () => null });
  Object.defineProperty(h, "mode", { get: () => "off" });
}

function read(h: Holder, really: boolean): void {
  if (h.shape instanceof Square && typeof h.value === "number" && h.leaf !== null && h.mode === "on") {
    if (really) replace(h);
    say("edge", h.shape.edge);
    say("corner", h.shape.corner);
    say("sides", h.shape.sides);
    say("value", h.value);
    say("value plus one", h.value + 1);
    say("value doubled", h.value * 2);
    say("leaf", h.leaf === null ? "null" : "a square");
    say("mode", h.mode);
    say("mode is on", h.mode === "on");
  }
}

read(new Holder(), false);
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const h = new Holder();
  if (h.shape instanceof Square && typeof h.value === "number") sum += h.shape.edge + h.value;
}
say("honest rounds", sum);
read(new Holder(), true);
read(new Holder(), false);
