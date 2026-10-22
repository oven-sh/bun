class Base {
  x = 1;
  y: number;
  constructor(y: number = 2) {
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
}

const Bound = Base.bind(null);

try {
  class Derived extends Bound {
    extra = "d";
  }
  console.log("defined: " + Object.keys(new Derived()).join(" "));
} catch (error) {
  console.log("the definition threw a TypeError: " + (error instanceof TypeError));
}
console.log("the bound class alone: " + JSON.stringify(new Bound(5)) + " " + (new Bound() instanceof Base));
