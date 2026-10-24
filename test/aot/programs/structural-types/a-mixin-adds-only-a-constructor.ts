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

let calls = 0;

function Mixed(Base: new () => object) {
  return class extends Base {
    constructor() {
      super();
      calls++;
    }
  };
}

const Made = Mixed(Point);
const made = new Made();
console.log(describe(made));
console.log("its own: " + String(calls) + " calls " + calls);
console.log("instance: " + (made instanceof Point) + " " + (made instanceof Made));
console.log("a second one: " + describe(new Made()));
