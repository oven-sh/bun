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

const s: Shape = new Shape();
if (s instanceof Square) {
  s.edge = 7;
  say("edge", s.edge);
  say("keys", Object.keys(s).length);
}
