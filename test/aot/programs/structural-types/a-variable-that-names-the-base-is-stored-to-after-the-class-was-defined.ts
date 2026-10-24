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

class Other {
  x = 100;
  y = 200;
  sum(): number {
    return -1;
  }
}

let Current: new () => { x: number; y: number; sum(): number } = Point;

class Derived extends Current {
  extra = "dq";
}

console.log("before: " + describe(new Derived()) + " " + new Derived().sum());
Current = Other;
console.log("after: " + describe(new Derived()) + " " + new Derived().sum() + " " + (new Derived() instanceof Point));

class Second extends Current {
  extra = "dq";
}
console.log("a class defined later: " + describe(new Second()) + " " + new Second().sum());
