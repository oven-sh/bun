// An uncaught exception thrown while the entry module is suspended in
// top-level await must be fatal immediately (node parity). The awaits below
// must not resume once the timer callback throws with no
// process.on('uncaughtException') listener installed.
const sleep = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => {
  throw new Error("boom-during-tla");
}, 1);
for (let i = 0; i < 50; i++) await sleep(5);
console.log("UNREACHABLE-AFTER-FATAL");
