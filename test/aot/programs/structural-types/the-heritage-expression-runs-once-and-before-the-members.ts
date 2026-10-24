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

const seen: string[] = [];

function give(): typeof Point {
  seen.push("heritage");
  return Point;
}

function key(): "computed" {
  seen.push("computed key");
  return "computed";
}

class Derived extends give() {
  static first = seen.push("static field");
  field = seen.push("instance field");
  [key()](): string {
    return "a method under a computed name";
  }
  static {
    seen.push("static block");
  }
}

console.log("after the definition: " + seen.join(", "));
new Derived();
new Derived();
console.log("after two constructions: " + seen.join(", "));
console.log(describe(new Derived()));
