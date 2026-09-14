import { read } from "bun:ffi";

// Loaded, asked for one address, and dropped: nothing here refers to the module afterwards.
const count = (() =>
  require("./handlers-registered-by-a-module-nothing-refers-to.c").address_of_the_count())();
delete require.cache[
  require.resolve("./handlers-registered-by-a-module-nothing-refers-to.c")
];
for (let round = 0; round < 5; round++) {
  Bun.gc(true);
  // Make and run other code, so that memory the module had would be used again.
  for (let i = 0; i < 50; i++)
    new Function(
      "a",
      `let s = 0; for (let i = 0; i < 1e4; i++) s += a * ${round * 50 + i}; return s`,
    )(1);
}
process.kill(process.pid, "SIGUSR1");
process.kill(process.pid, "SIGUSR1");
// A signal is delivered before kill returns to the thread that sent it to its own process.
console.log("signals counted:", read.i32(count));
console.log("javascript is done");
