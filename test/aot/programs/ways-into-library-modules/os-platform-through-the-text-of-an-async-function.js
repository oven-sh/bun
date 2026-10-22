// One name of node:os is imported and used; another, platform, is found through text given to the constructor of async functions. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { EOL } from "node:os";
const seen = [];
console.log("the name that is imported:", String(EOL.length));
const key = ["plat", "form"].join("");
const name = ["node:", "os"].join("");
let told;
try {
  const whole = await (async () => {}).constructor("name", "return process.getBuiltinModule(name)")(name);
  const F = whole[key];
  const answer = String(typeof F());
  told = answer === "string" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
