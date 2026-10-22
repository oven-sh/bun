// One key that Object.defineProperties defines under is computed, so the program does not say which members of process are looked for.
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
const name = ["final", "ization"].join("");
attempt("the definition", () => Object.defineProperties(process, { markOfThisProgram: anew(1), [name]: anew(2) }) === process);
attempt("console.log", () => console.log("prints"));
