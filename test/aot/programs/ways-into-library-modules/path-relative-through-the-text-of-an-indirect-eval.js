// One name of node:path is imported and used; another, relative, is found through the text of an indirect eval. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { join } from "node:path";
const seen = [];
console.log("the name that is imported:", String(join("a", "b")));
const key = ["rela", "tive"].join("");
const name = ["node:", "path"].join("");
let told;
try {
  const whole = (0, eval)("process.getBuiltinModule")(name);
  const F = whole[key];
  const answer = String(F("/a/b", "/a/c"));
  told = answer === "../c" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
