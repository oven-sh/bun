// One name of node:string_decoder is imported and used; another, StringDecoder, is found through process.getBuiltinModule, taken by a destructuring pattern under a name that is put together at run time, and is used too.
import { StringDecoder } from "node:string_decoder";
const seen = [];
console.log("the name that is imported:", String(typeof StringDecoder));
const key = ["String", "Decoder"].join("");
const name = ["node:", "string_decoder"].join("");
const { getBuiltinModule } = process;
const whole = getBuiltinModule(name);
const F = whole[key];
try {
  console.log("the other member:", String(new F("utf8").write(Buffer.from("a"))));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
