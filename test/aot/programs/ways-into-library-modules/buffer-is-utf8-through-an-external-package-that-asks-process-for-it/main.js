// One name of node:buffer is imported and used; another, isUtf8, is found through a package marked --external, which asks process.getBuiltinModule for it, and is used too.
import { kMaxLength } from "node:buffer";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(typeof kMaxLength));
const key = ["isU", "tf8"].join("");
const name = ["node:", "buffer"].join("");
const whole = take(name);
const F = whole[key];
try {
  console.log("the other member:", String(F(new Uint8Array([97]))));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
