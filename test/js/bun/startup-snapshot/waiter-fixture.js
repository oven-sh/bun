// Spawning on a build that uses the waiter thread (forced here) starts that thread; a snapshot cannot contain it.
await Bun.spawn({ cmd: [process.execPath, "-e", ""], stdout: "ignore", stderr: "ignore" }).exited;
process.on("restore", async () => {
  const code = await Bun.spawn({ cmd: [process.execPath, "-e", ""], stdout: "ignore", stderr: "ignore" }).exited; // a fresh waiter thread
  console.log(`[js] spawn after restore exited ${code}`);
  process.exit(0);
});
setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
