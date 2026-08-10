// A thread cannot be in a snapshot: taking one while a worker is running has to be refused, and refused by name.
const w = new Worker(URL.createObjectURL(new Blob(["setInterval(() => {}, 1000);"], { type: "application/javascript" })));
w.addEventListener("open", async () => {
  if (process.env.TERMINATE_FIRST) await w.terminate(); // then the count must be back to zero — after the thread has fully torn down
  Bun.startupSnapshot.take({ timers: "cancel" });
});
if (process.env.TERMINATE_FIRST) process.on("restore", () => { console.log("[js] restored after a terminated worker"); process.exit(0); });
setTimeout(() => process.exit(3), 20_000); // safety net only; the runtime gives up first (the test shortens its wait)
