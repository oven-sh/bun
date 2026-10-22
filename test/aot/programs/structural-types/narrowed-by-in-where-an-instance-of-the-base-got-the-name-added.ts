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

function make(which: number): Shape | Square {
  if (which === 0) return new Square();
  if (which === 1) return new Shape();
  return Object.assign(new Shape(), { edge: "added" });
}

for (let which = 0; which < 3; which++) {
  const s = make(which);
  if ("edge" in s) {
    say(which + " edge", s.edge);
    say(which + " edge doubled", s.edge * 2);
    say(which + " corner", s.corner);
    say(which + " sides", s.sides);
  } else {
    say(which + " sides only", s.sides);
  }
}
