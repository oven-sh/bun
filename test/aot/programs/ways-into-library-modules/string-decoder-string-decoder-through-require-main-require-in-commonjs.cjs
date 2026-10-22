// One name of node:string_decoder is imported and used; another, StringDecoder, is found through require.main.require in a CommonJS file under a name that is put together at run time, and is used too.
const { StringDecoder } = require("node:string_decoder");
const seen = [];
console.log("the name that is imported:", String(typeof StringDecoder));
const key = ["String", "Decoder"].join("");
const name = ["node:", "string_decoder"].join("");
const whole = require.main.require(name);
const F = whole[key];
try {
  console.log("the other member:", String(new F("utf8").write(Buffer.from("a"))));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
