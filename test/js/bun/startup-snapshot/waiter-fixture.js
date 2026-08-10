// Spawning on a build that uses the waiter thread (forced here) starts that thread; a snapshot cannot contain it.
// Not bun itself: a child bun would inherit the snapshot variables and restore/take too (recursively, in the restored case).
await Bun.spawn({ cmd: ["/bin/sh", "-c", "exit 0"], stdout: "ignore", stderr: "ignore" }).exited;
process.on("restore", async () => {
  const code = // Not bun itself: a child bun would inherit the snapshot variables and restore/take too (recursively, in the restored case).
await Bun.spawn({ cmd: ["/bin/sh", "-c", "exit 0"], stdout: "ignore", stderr: "ignore" }).exited; // a fresh waiter thread
  console.log(`[js] spawn after restore exited ${code}`);
  process.exit(0);
});
setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
