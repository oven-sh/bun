// One name of node:string_decoder is imported and used; another, StringDecoder, is found through a module of the program that exports all of it again under a name that is put together at run time, and is used too.
import { StringDecoder } from "node:string_decoder";
import * as whole from "./all.js";
const seen = [];
console.log("the name that is imported:", String(typeof StringDecoder));
const key = ["String", "Decoder"].join("");
const F = whole[key];
try {
  console.log("the other member:", String(new F("utf8").write(Buffer.from("a"))));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
