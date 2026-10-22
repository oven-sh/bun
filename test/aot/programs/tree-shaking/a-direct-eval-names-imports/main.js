// The text given to eval names an imported function, a default import and a member of a namespace import. No other code of the program names what lib.ts exports.
import { named } from "./lib";
import byDefault from "./lib";
import * as lib from "./lib";

console.log(eval("named()"));
console.log(eval("byDefault()"));
console.log(eval("lib.member()"));
function inner() {
  return eval("lib['comp' + 'uted']()");
}
console.log(inner());
