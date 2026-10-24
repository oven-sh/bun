// The one use of each import stands in a function that nobody calls. The import statement is still there, so the imported files are evaluated, in the order of the statements.
import { helper } from "./first";
import * as second from "./second";
import third from "./third";

function unused() {
  return helper() + second.value() + third();
}
const alsoUnused = () => helper();
class Unused {
  method() {
    return third();
  }
}

console.log("main.ts runs");
