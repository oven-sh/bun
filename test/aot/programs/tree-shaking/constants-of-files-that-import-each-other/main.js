// a.js and b.js import each other. Each has constants the other uses, constants only this file uses, and constants nobody uses. Some are read while the other file has not finished: a function declaration works, a constant throws. The files say what they saw.
import { fromA, seenByA, tableOfA } from "./a.js";
import { fromB, seenByB } from "./b.js";

console.log(fromA, fromB, tableOfA.b);
console.log(seenByA.join(), "/", seenByB.join());
