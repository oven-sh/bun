// With an 'uncaughtException' listener installed the exception is handled,
// so top-level await evaluation must continue and the process exits 0.
process.on("uncaughtException", err => console.log("caught:" + err.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => {
  throw new Error("boom-during-tla");
}, 1);
for (let i = 0; i < 50; i++) await sleep(5);
console.log("module-end");
