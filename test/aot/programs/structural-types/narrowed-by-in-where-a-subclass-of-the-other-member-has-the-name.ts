function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Circle {
  radius = 1;
}

class Square {
  edge = 2;
}

class Labeled extends Circle {
  edge = "text";
}

function pick(which: number): Circle | Square {
  return which === 0 ? new Circle() : which === 1 ? new Square() : new Labeled();
}

for (let which = 0; which < 3; which++) {
  const s = pick(which);
  if ("edge" in s) {
    say(which + " edge", s.edge);
    say(which + " edge doubled", s.edge * 2);
    say(which + " edge plus one", s.edge + 1);
  } else {
    say(which + " radius", s.radius);
  }
}
