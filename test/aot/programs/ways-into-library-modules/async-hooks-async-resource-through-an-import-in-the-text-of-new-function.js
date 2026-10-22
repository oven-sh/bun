// One name of node:async_hooks is imported and used; another, AsyncResource, is found through import() in the text of new Function. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { executionAsyncId } from "node:async_hooks";
const seen = [];
console.log("the name that is imported:", String(typeof executionAsyncId()));
const key = ["AsyncR", "esource"].join("");
const name = ["node:", "async_hooks"].join("");
let told;
try {
  const whole = await new Function("name", "return import(name)")(name);
  const F = whole[key];
  const answer = String(new F("kind").runInAsyncScope(() => 5));
  told = answer === "5" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
