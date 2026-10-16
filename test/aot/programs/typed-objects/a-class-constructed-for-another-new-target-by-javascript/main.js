// Reflect.construct() with another new.target, written in a JavaScript file, of a class that a TypeScript file declares.
import { Shape, total } from "./shapes.ts";
function Target() {}
Target.prototype.hi = function () { return "Target.hi"; };
class Below extends Shape { hi() { return "Below.hi " + this.sides; } }
const attempt = run => { try { return String(run()); } catch (error) { return "throws " + error.name + ": " + error.message.slice(0, 60); } };
const tell = (made, target) => [Object.getPrototypeOf(made) === target.prototype, made.hi(), JSON.stringify(made), Object.keys(made).join()].join(" ");
console.log("a function:", attempt(() => tell(Reflect.construct(Shape, [3], Target), Target)));
console.log("a class of this file that extends it:", attempt(() => tell(Reflect.construct(Shape, [4], Below), Below)));
console.log("Object:", attempt(() => JSON.stringify(Reflect.construct(Shape, [5], Object))));
console.log(total([new Shape(3), new Shape(4), new Below(5)]), new Shape(6).hi(), new Below(7).hi());
