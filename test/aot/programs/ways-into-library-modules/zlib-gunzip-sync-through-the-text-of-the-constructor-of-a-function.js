// One name of node:zlib is imported and used; another, gunzipSync, is found through text given to the constructor property of a function. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { gzipSync } from "node:zlib";
const seen = [];
console.log("the name that is imported:", String(gzipSync("a").length > 0));
const key = ["gunzi", "pSync"].join("");
const name = ["node:", "zlib"].join("");
let told;
try {
  const whole = (() => {}).constructor("name", "return process.getBuiltinModule(name)")(name);
  const F = whole[key];
  const answer = String(F(gzipSync("text")).toString());
  told = answer === "text" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
