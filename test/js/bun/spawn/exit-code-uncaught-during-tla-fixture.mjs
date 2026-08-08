// An uncaught exception while the entry module is suspended in top-level
// await must be immediately fatal (node parity): the awaits below must not
// resume once the timer throws with no 'uncaughtException' listener.
const sleep = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => {
  throw new Error("boom-during-tla");
}, 1);
for (let i = 0; i < 50; i++) await sleep(5);
console.log("UNREACHABLE-AFTER-FATAL");
