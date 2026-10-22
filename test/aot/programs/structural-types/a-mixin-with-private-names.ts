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

function Secret(Base: new () => object) {
  return class Keeper extends Base {
    #hidden = 5;
    #twice(): number {
      return this.#hidden * 2;
    }
    static #made = 0;
    open = "open";
    constructor() {
      super();
      Keeper.#made++;
    }
    reveal(): string {
      return this.#hidden + " " + this.#twice() + " " + Keeper.#made;
    }
    static owns(value: object): boolean {
      return #hidden in value;
    }
  };
}

const A = Secret(Point);
const B = Secret(Point);
const a = new A();
console.log(describe(a) + " reveal " + a.reveal());
console.log("a second one: " + new A().reveal());
console.log("brands: " + A.owns(a) + " " + B.owns(a) + " " + A.owns(new Point()));
try {
  console.log(B.prototype.reveal.call(a));
} catch (error) {
  console.log("the other class's method threw a TypeError: " + (error instanceof TypeError));
}
