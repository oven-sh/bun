// One name of node:zlib is imported and used; another, createGzip, is found through text given to Reflect.construct of Function. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { gzipSync } from "node:zlib";
const seen = [];
console.log("the name that is imported:", String(gzipSync("a").length > 0));
const key = ["creat", "eGzip"].join("");
const name = ["node:", "zlib"].join("");
let told;
try {
  const whole = Reflect.construct(Function, ["name", "return process.getBuiltinModule(name)"])(name);
  const F = whole[key];
  const answer = String(typeof F().write);
  told = answer === "function" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
