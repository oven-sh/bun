// One name of node:async_hooks is imported and used; another, AsyncLocalStorage, is found through text given to the constructor of async functions. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { executionAsyncId } from "node:async_hooks";
const seen = [];
console.log("the name that is imported:", String(typeof executionAsyncId()));
const key = ["AsyncLoc", "alStorage"].join("");
const name = ["node:", "async_hooks"].join("");
let told;
try {
  const whole = await (async () => {}).constructor("name", "return process.getBuiltinModule(name)")(name);
  const F = whole[key];
  const answer = String((storage => storage.run(5, () => storage.getStore()))(new F()));
  told = answer === "5" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
