function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Returns {
  constructor(o: object) {
    return o;
  }
}

class Stamp extends Returns {
  #mark = 1;
  edge = 2;
  area(): number {
    return this.edge * this.#mark;
  }
  static marked(o: object): unknown {
    if (#mark in o) {
      return [o.#mark, o.edge, typeof o.area, o instanceof Stamp].join();
    }
    return "no mark";
  }
  static area(o: object): number {
    if (#mark in o) return o.area();
    return -1;
  }
}

class Circle {
  radius = 5;
}

const circle = new Circle();
say("before", Stamp.marked(circle));
const stamped = new Stamp(circle);
say("the result is the circle", Object.is(stamped, circle));
say("after", Stamp.marked(circle));
say("keys", Object.keys(circle).join());
say("radius", circle.radius);
say("typed Stamp: edge", stamped.edge);
say("typed Stamp: instanceof", stamped instanceof Stamp);
try {
  say("a method through the narrowed type", Stamp.area(circle));
} catch (error) {
  say("a method through the narrowed type threw a TypeError", error instanceof TypeError);
}
try {
  say("a method through the result", stamped.area());
} catch (error) {
  say("a method through the result threw a TypeError", error instanceof TypeError);
}
try {
  new Stamp(circle);
  say("stamped twice", "no error");
} catch (error) {
  say("stamped twice threw a TypeError", error instanceof TypeError);
}
say("a stamped literal", Stamp.marked(new Stamp({})));
