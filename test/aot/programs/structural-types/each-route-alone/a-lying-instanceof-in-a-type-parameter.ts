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

function generic<T extends Shape>(s: T): unknown {
  return s instanceof Square ? s.edge : "other";
}
say("edge", generic(new Shape()));
