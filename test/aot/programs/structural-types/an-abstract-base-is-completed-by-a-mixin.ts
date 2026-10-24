function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

abstract class Shape {
  sides = 4;
  abstract area(): number;
  report(): string {
    return this.sides + " sides, area " + this.area();
  }
}

function Sized(Base: abstract new () => Shape) {
  return class extends Base {
    edge = 3;
    area(): number {
      return this.edge * this.edge;
    }
  };
}

const made = new (Sized(Shape))();
console.log(describe(made));
console.log(made.report() + " instance: " + (made instanceof Shape));
