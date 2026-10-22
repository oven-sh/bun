// One name of node:util is imported and used, and so is node:assert, which reads node:util by names of its own; another, stripVTControlCharacters, is found through a namespace import under a name that is put together at run time, and is used too.
import { format } from "node:util";
import { strictEqual } from "node:assert";
import * as whole from "node:util";
const seen = [];
console.log("the name that is imported:", String(format("%s", 1)));
console.log("the other library module:", String(strictEqual(1, 1)));
const key = ["stripVTContr", "olCharacters"].join("");
const F = whole[key];
try {
  console.log("the other member:", String(F("\u001b[1ma")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
