// The export that is called as a member reads `this` only inside an arrow function, hands it to a helper, or takes it apart in a pattern. An arrow export and a nested ordinary function have no such `this`.
import * as lib from "./lib.js";

console.log(lib.throughArrow());
console.log(lib.handsItOn());
console.log(lib.takesItApart());
console.log(lib.nestedFunction());
