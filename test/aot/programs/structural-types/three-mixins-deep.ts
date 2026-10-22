function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Point {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

function First(Base: new () => object) {
  return class extends Base {
    first = "f1";
  };
}

function Second(Base: new () => object) {
  return class extends Base {
    second = "s2";
  };
}

function Third(Base: new () => object) {
  return class extends Base {
    third = "t3";
  };
}

console.log("one: " + describe(new (First(Point))()));
console.log("two: " + describe(new (Second(First(Point)))()));
console.log("three: " + describe(new (Third(Second(First(Point))))()));
console.log("another order: " + describe(new (First(Second(Third(Point))))()));
const Deep = Third(Second(First(Point)));
const made = new Deep();
console.log("own member: " + made.third + " instance of Point: " + (made instanceof Point));
class Named extends Deep {
  named = "n4";
}
console.log("a named class on top: " + describe(new Named()));
