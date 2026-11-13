// Prints what a consumer that takes one 'data' event at a time gets from process.stdin, as JSON. Node prints the same line.
//
// usage: <runtime> once-data.fixture.js <form>
//
// form: what the loop of `await once(process.stdin, "data")` does between two once() calls
//   tick   it awaits a promise that a nextTick settles
//   pause  pause(), the same await, resume()
const { once } = require("node:events");

const form = process.argv[2];
const stdin = process.stdin;
// The bytes of the chunks that the loop got, and of those that it was done with when 'end' came.
let bytes = 0;
let done = 0;
let doneAtEnd = -1;
stdin.on("end", () => {
  doneAtEnd = done;
});
process.on("exit", () => {
  console.log(JSON.stringify({ bytes, doneAtEnd }));
});

(async () => {
  for (;;) {
    const [chunk] = await once(stdin, "data");
    bytes += chunk.length;
    if (form === "pause") stdin.pause();
    await new Promise(resolve => process.nextTick(resolve));
    if (form === "pause") stdin.resume();
    done += chunk.length;
  }
})();
