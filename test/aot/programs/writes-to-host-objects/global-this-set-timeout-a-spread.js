// globalThis.setTimeout is copied by a spread of the holder and is never read by that name; then the program uses what the run time keeps up behind it.
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
const copy = { ...globalThis };
attempt("the copy", () => typeof copy.setTimeout);
await attemptLater("a timer of the library", async () => {
  const timers = await import("node:timers/promises");
  return await timers.setTimeout(1, "fired");
});
await attemptLater("Bun.sleep", async () => {
  await Bun.sleep(1);
  return "slept";
});
