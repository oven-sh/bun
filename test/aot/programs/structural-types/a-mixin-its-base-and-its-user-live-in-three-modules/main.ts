import { Point } from "./point.ts";
import { describe } from "./show.ts";
import { Tagged } from "./tagged.ts";

const Made = Tagged(Point);
const made = new Made();
console.log(describe(made));
console.log("tag: " + made.tag + " instance: " + (made instanceof Point));
class Local {
  here = "local";
}
console.log(describe(new (Tagged(Local))()));
console.log(describe(new Made()));
