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

function Tagged(Base: new () => Point) {
  return class extends Base {
    tag = "tagged";
  };
}

class Named extends Tagged(Point) {
  named = "named";
  all(): string {
    return this.x + " " + this.y + " " + this.tag + " " + this.named + " " + this.sum();
  }
}

const made = new Named();
console.log(describe(made));
console.log(made.all());
console.log("instance: " + (made instanceof Named) + " " + (made instanceof Point));
class Deeper extends Named {
  deeper = "deeper";
}
console.log(describe(new Deeper()) + " " + new Deeper().all());
