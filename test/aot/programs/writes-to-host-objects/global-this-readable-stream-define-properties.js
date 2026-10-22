// globalThis.ReadableStream is defined anew by Object.defineProperties and is never read by that name; then the program uses what the run time keeps up behind it.
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
async function attemptLater(what, run) {
  try {
    console.log(what, String(await run()));
  } catch (error) {
    console.log(what, "threw " + told(error));
  }
}
attempt("the definition", () => Object.defineProperties(globalThis, { ReadableStream: { value: 1, writable: true, enumerable: true, configurable: true } }) === globalThis);
await attemptLater("the body of a response", async () => {
  const piece = await new Response("text").body.getReader().read();
  return piece.value.length;
});
