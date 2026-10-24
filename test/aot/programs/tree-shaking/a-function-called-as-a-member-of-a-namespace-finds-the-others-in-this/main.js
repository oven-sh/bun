// `lib.start()` runs start with `this` = the namespace object, and start calls two other exports through `this`. Nothing names those.
import * as lib from "./lib.js";

console.log(lib.start());
console.log(lib["startByName"]("third"));
