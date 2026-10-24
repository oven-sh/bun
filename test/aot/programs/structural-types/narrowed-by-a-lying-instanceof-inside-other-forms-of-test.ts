function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object";
  }
}

function mustHold(condition: boolean): asserts condition {
  if (!condition) throw new RangeError("does not hold");
}

const first: Shape = new Shape();
switch (true) {
  case first instanceof Square:
    say("switch true: edge", first.edge);
    say("switch true: edge doubled", first.edge * 2);
    break;
  default:
    say("switch true: sides", first.sides);
}

const second: Shape = new Shape();
const isSquare = second instanceof Square;
if (isSquare) {
  say("a condition in a constant: edge", second.edge);
  say("a condition in a constant: edge doubled", second.edge * 2);
}

const third: Shape = new Shape();
mustHold(third instanceof Square);
say("an asserted condition: edge", third.edge);
say("an asserted condition: edge doubled", third.edge * 2);

const fourth: Shape = new Shape();
say("a conditional: edge", fourth instanceof Square ? fourth.edge : "other");
say("and: edge", fourth instanceof Square && fourth.edge);
say("or: edge", !(fourth instanceof Square) || fourth.edge);

function generic<T extends Shape>(s: T): unknown {
  return s instanceof Square ? s.edge : "other";
}
say("a type parameter: edge", generic(new Shape()));
