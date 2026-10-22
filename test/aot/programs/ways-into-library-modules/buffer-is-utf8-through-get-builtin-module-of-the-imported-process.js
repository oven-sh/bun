// One name of node:buffer is imported and used; another, isUtf8, is found through getBuiltinModule of the default import of node:process under a name that is put together at run time, and is used too.
import { kMaxLength } from "node:buffer";
import host from "node:process";
const seen = [];
console.log("the name that is imported:", String(typeof kMaxLength));
const key = ["isU", "tf8"].join("");
const name = ["node:", "buffer"].join("");
const whole = host.getBuiltinModule(name);
const F = whole[key];
try {
  console.log("the other member:", String(F(new Uint8Array([97]))));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
