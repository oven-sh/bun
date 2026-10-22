// One name of node:url is imported and used; another, Url, is found through the text of Function, called without new. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { fileURLToPath } from "node:url";
const seen = [];
console.log("the name that is imported:", String(fileURLToPath("file:///a/b")));
const key = ["U", "rl"].join("");
const name = ["node:", "url"].join("");
let told;
try {
  const whole = Function("name", "return process.getBuiltinModule(name)")(name);
  const F = whole[key];
  const answer = String(new F().parse("http://host/path").host);
  told = answer === "host" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
