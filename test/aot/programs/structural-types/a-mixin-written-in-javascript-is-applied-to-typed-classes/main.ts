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

import { Tagged } from "./tagged.js";

const Made = Tagged(Point);
const made = new Made();
console.log(describe(made));
console.log("members: " + made.x + " " + made.y + " " + made.sum() + " " + made.tag + " " + made.late);
console.log("instance: " + (made instanceof Point));
class Typed extends Tagged(Point) {
  typed = "a typed field on top";
}
console.log(describe(new Typed()) + " " + new Typed().sum());
