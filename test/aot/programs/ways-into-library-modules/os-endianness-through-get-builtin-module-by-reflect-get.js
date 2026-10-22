// One name of node:os is imported and used; another, endianness, is found through process.getBuiltinModule, found by Reflect.get under a name that is put together at run time, and is used too.
import { EOL } from "node:os";
const seen = [];
console.log("the name that is imported:", String(EOL.length));
const key = ["endia", "nness"].join("");
const name = ["node:", "os"].join("");
const whole = Reflect.get(process, "getBuiltinModule")(name);
const F = whole[key];
try {
  console.log("the other member:", String(F()));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
