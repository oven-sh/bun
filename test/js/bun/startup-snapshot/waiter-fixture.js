// Spawning on a build that uses the waiter thread (forced here) starts that thread; a snapshot cannot contain it. The child is
// sh rather than bun: a child bun would inherit the snapshot variables and restore (or take) as well.
const child = () => Bun.spawn({ cmd: ["/bin/sh", "-c", "exit 0"], stdout: "ignore", stderr: "ignore" }).exited;
await child();
process.on("restore", async () => {
  const code = await child(); // reaped by a waiter thread started in this process
  console.log(`[js] spawn after restore exited ${code}`);
  process.exit(0);
});
setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
