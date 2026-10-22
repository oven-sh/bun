// One name of node:stream is imported and used; another, Readable, is found through getBuiltinModule, imported from node:process by name under a name that is put together at run time, and is used too.
import { finished } from "node:stream";
import { getBuiltinModule } from "node:process";
const seen = [];
console.log("the name that is imported:", String(typeof finished));
const key = ["Read", "able"].join("");
const name = ["node:", "stream"].join("");
const whole = getBuiltinModule(name);
const F = whole[key];
try {
  console.log("the other member:", String((await F.from(["a", "b"]).toArray()).join()));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
