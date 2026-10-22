// One name of node:string_decoder is imported and used; another, StringDecoder, is found through the text of a vm.Script. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { StringDecoder } from "node:string_decoder";
const seen = [];
console.log("the name that is imported:", String(typeof StringDecoder));
const key = ["String", "Decoder"].join("");
const name = ["node:", "string_decoder"].join("");
let told;
try {
  const whole = new (await import("node:vm")).Script("process.getBuiltinModule").runInThisContext()(name);
  const F = whole[key];
  const answer = String(new F("utf8").write(Buffer.from("a")));
  told = answer === "a" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
