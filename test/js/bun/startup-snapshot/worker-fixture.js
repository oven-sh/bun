// A thread cannot be in a snapshot: taking one while a worker is running has to be refused, and refused by name.
const w = new Worker(URL.createObjectURL(new Blob(["setInterval(() => {}, 1000);"], { type: "application/javascript" })));
w.addEventListener("open", () => Bun.startupSnapshot.take({ timers: "cancel" }));
setTimeout(() => process.exit(3), 20_000); // safety net only; the runtime gives up first (the test shortens its wait)
