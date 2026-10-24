// The literal that Object.defineProperties takes its keys from stands behind a type assertion.
// How a TypeError of the language names what is no function is not what is tested here.
const told = (error: any) => error.constructor.name + (error instanceof TypeError && !/compiled/.test(error.message) ? "" : ": " + error.message);
function attempt(what: string, run: () => unknown) {
  try {
    const answer = run();
    console.log(what, typeof answer === "object" || typeof answer === "function" ? typeof answer : String(answer));
  } catch (error) {
    console.log(what, "threw " + told(error));
  }
}
const anew = (value: unknown) => ({ value, writable: true, enumerable: true, configurable: true });
attempt("the definition", () => Object.defineProperties(process, { finalization: anew(1), allowedNodeEnvironmentFlags: anew(2) } as PropertyDescriptorMap) === process);
attempt("console.log", () => console.log("prints"));
