// "sideEffects": false. Each of two barrels exports one name of its own files and passes on the other's. The program asks the left one for a name that the right one holds, and the right one for a name that the left one holds. Every file prints when it is evaluated. `bun build --compile` leaves out the two files that nothing asks for.
import { fromRight } from "two-barrels/left.js";
import { fromLeft } from "two-barrels/right.js";

console.log(fromRight(), fromLeft());
