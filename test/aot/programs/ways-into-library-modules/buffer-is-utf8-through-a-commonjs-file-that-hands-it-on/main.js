// One name of node:buffer is imported and used; another, isUtf8, is found through a CommonJS file of the program whose exports object it is under a name that is put together at run time, and is used too.
import { kMaxLength } from "node:buffer";
import whole from "./all.cjs";
const seen = [];
console.log("the name that is imported:", String(typeof kMaxLength));
const key = ["isU", "tf8"].join("");
const F = whole[key];
try {
  console.log("the other member:", String(F(new Uint8Array([97]))));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
