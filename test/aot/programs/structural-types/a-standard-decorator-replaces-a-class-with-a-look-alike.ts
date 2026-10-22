function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Stranger {
  y = 200;
  x = 100;
  extra = "a member of the stranger";
  sum(): number {
    return -1;
  }
  static origin(): Stranger {
    return new Stranger();
  }
}

function swapped(target: unknown, context: ClassDecoratorContext): typeof Stranger {
  return Stranger;
}

@swapped
class Point {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
  static origin(): Point {
    return new Point();
  }
}

const made = new Point();
console.log(describe(made));
console.log("members: " + made.x + " " + made.y + " " + made.sum());
console.log("instance: " + (made instanceof Point) + " " + (made instanceof Stranger) + " same class: " + Object.is(Point, Stranger));
console.log("origin: " + describe(Point.origin()));
class Child extends Point {
  z = 3;
}
console.log("a subclass: " + describe(new Child()) + " " + new Child().sum());
