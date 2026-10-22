// Bun.env is defined anew by a descriptor without a value, so that it keeps its own and is never read by that name; then the program uses what the run time keeps up behind it.
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
attempt("the definition", () => Object.defineProperty(Bun, "env", { enumerable: false }) === Bun);
attempt("process.env", () => typeof process.env);
