// One name of node:os is imported and used; another, platform, is found through process.getBuiltinModule, handed to then under a name that is put together at run time, and is used too.
import { EOL } from "node:os";
const seen = [];
console.log("the name that is imported:", String(EOL.length));
const key = ["plat", "form"].join("");
const name = ["node:", "os"].join("");
const whole = await Promise.resolve(name).then(process.getBuiltinModule);
const F = whole[key];
try {
  console.log("the other member:", String(typeof F()));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
