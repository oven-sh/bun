// Run with `bun test --concurrent`. The two tests overlap (each one waits for the other to start), and each
// one's signal aborts when that test ends.
const { test } = require("node:test");

const log = (...args) => console.log("OBS", ...args);
const both = Promise.withResolvers();
let started = 0;

for (const name of ["first", "second"]) {
  test(name, async t => {
    t.signal.addEventListener("abort", () => log(`${name}: abort event`));
    if (++started === 2) both.resolve();
    await both.promise;
    log(`${name}: body ends`, "aborted=" + t.signal.aborted);
  });
}
