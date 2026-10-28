// A Worker throws in a microtask and nobody catches it. An async function of the Worker waits at an await behind that microtask. The Worker stops at the error: the function does not go on, and a thenable that it awaits is not asked.
for (const file of ["./awaits-a-promise.js", "./awaits-a-thenable.js"]) {
  const events = [];
  const worker = new Worker(new URL(file, import.meta.url).href);
  worker.addEventListener("error", event => {
    events.push("error " + /\w+: stop/.exec(event.message)?.[0]);
    event.preventDefault();
  });
  events.push("close " + (await new Promise(resolve => worker.addEventListener("close", event => resolve(event.code)))));
  console.log(file, events.join(", "));
}
