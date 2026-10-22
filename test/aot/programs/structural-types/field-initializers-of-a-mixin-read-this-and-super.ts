function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

function kind(error: unknown): string {
  return error instanceof ReferenceError ? "a ReferenceError" : error instanceof TypeError ? "a TypeError" : "something else";
}

class Point {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

function Reading(Base: new () => Point) {
  return class extends Base {
    copy = this.x + this.y;
    viaSuper = super.sum();
    viaThis = this.sum();
    keysSoFar = Object.keys(this).join("+");
    later = () => this.copy + this.x;
    sum(): number {
      return -1;
    }
  };
}

const made = new (Reading(Point))();
console.log(describe(made));
console.log("later: " + made.later());
made.x = 10;
console.log("later: " + made.later());
