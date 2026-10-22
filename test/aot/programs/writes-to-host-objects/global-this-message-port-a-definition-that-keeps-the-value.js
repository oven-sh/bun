// globalThis.MessagePort is defined anew by a descriptor without a value, so that it keeps its own and is never read by that name; then the program uses what the run time keeps up behind it.
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
attempt("the definition", () => Object.defineProperty(globalThis, "MessagePort", { enumerable: false }) === globalThis);
await attemptLater("a message", async () => {
  const { port1, port2 } = new MessageChannel();
  const heard = new Promise(resolve => (port2.onmessage = event => resolve(event.data)));
  port1.postMessage("sent");
  const data = await heard;
  port1.close();
  port2.close();
  return data;
});
