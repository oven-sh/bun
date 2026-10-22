// What Object.defineProperties takes its keys from was made elsewhere and has got a key since.
// How a TypeError of the language names what is no function is not what is tested here.
const told = error => error.constructor.name + (error instanceof TypeError && !/compiled/.test(error.message) ? "" : ": " + error.message);
function attempt(what, run) {
  try {
    const answer = run();
    console.log(what, typeof answer === "object" || typeof answer === "function" ? typeof answer : String(answer));
  } catch (error) {
    console.log(what, "threw " + told(error));
  }
}
const anew = value => ({ value, writable: true, enumerable: true, configurable: true });
const descriptors = { markOfThisProgram: anew(1) };
descriptors[["final", "ization"].join("")] = anew(2);
attempt("the definition", () => Object.defineProperties(process, descriptors) === process);
attempt("console.log", () => console.log("prints"));
