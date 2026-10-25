// A JavaScript file that only exports the functions of a typed file again holds none of their objects. The JavaScript file that imports from it does: what it does to a record it has got that way is not refused either: that one object is an ordinary object from then on.
// IR+ : =?L[0-9]+ = NewObject 
import { run } from "./view.js";
import { makeCounter, showCounter } from "./state.ts";

console.log(run());
const untouched = makeCounter();
console.log(showCounter(untouched), Object.keys(untouched).join());
