// One name of node:buffer is imported and used; another, Buffer, is found through getBuiltinModule, imported from node:process by name under a name that is put together at run time, and is used too.
import { kMaxLength } from "node:buffer";
import { getBuiltinModule } from "node:process";
const seen = [];
console.log("the name that is imported:", String(typeof kMaxLength));
const key = ["Buf", "fer"].join("");
const name = ["node:", "buffer"].join("");
const whole = getBuiltinModule(name);
const F = whole[key];
try {
  console.log("the other member:", String(F.from("a").toString("hex")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
