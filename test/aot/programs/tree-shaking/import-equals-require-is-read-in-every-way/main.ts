// What `import lib = require()` binds is read by name, by a computed name, in a pattern, given away, exported again and used after new and extends.
import byName = require("./by-name");
import byComputed = require("./by-computed");
import byPattern = require("./by-pattern");
import givenAway = require("./given-away");
import classes = require("./classes");
export import exportedAgain = require("./exported-again");
import * as self from "./main";

console.log(byName.target());
console.log((byComputed as any)["tar" + "get"]());
const { target } = byPattern;
console.log(target());
function call(lib: { target(): string }) { return lib.target(); }
console.log(call(givenAway));
class Derived extends classes.Base {}
console.log(new Derived().method(), new classes.Other().method());
console.log(self.exportedAgain.target());
