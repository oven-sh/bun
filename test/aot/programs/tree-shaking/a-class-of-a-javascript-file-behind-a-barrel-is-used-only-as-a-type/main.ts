// "sideEffects": false, and the package is JavaScript with a declaration file. The program asks its barrel for one function, and names a class of another file only in types. Nothing asks the barrel for the class as a value, so box.js is never read, and the types that name the class come from the declarations. Every file prints when it is evaluated. `bun run` evaluates box.js; `bun build --compile` does not.
import { wanted, Box } from "declared-barrel";

function width(box: Box | null): number {
  return box === null ? 0 : box.width;
}
const boxes: Box[] = [];
console.log(wanted(), width(null), boxes.length);
