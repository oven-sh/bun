// One name of node:os is imported and used; another, endianness, is found through a package marked --external, which requires the module by the name it is handed, and is used too.
import { EOL } from "node:os";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(EOL.length));
const key = ["endia", "nness"].join("");
const name = ["node:", "os"].join("");
const whole = take(name);
const F = whole[key];
try {
  console.log("the other member:", String(F()));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
