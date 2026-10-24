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

function Counted(Base: new () => object) {
  return class Counter extends Base {
    static made = 0;
    static label = "label of " + Base.name;
    static {
      seen.push("static block for " + Base.name);
    }
    static create(): Counter {
      Counter.made++;
      return new this();
    }
    mine = "mine";
  };
}

class Other {
  first = "f";
}

const A = Counted(Point);
const B = Counted(Other);
A.create();
A.create();
B.create();
console.log("blocks: " + seen.join(", "));
console.log("counts: " + A.made + " " + B.made + " labels: " + A.label + ", " + B.label);
console.log("made: " + describe(A.create()) + " | " + describe(B.create()));
console.log("static keys: " + Object.keys(A).join(" "));
