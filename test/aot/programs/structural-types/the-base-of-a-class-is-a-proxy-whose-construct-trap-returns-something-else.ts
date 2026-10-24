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

const Wrapped = new Proxy(Point, {
  construct() {
    return { x: 50, y: 60, sum: () => -1, stranger: true };
  },
});

class Derived extends Wrapped {
  extra = "dq";
  twice(): number {
    return this.sum() * 2;
  }
}

const made = new Derived();
console.log(describe(made));
console.log("members: " + made.x + " " + made.y + " " + made.extra + " " + made.sum() + " typeof twice " + typeof made.twice);
console.log("instance: " + (made instanceof Derived) + " " + (made instanceof Point));
