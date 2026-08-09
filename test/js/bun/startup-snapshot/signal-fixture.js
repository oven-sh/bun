// A signal listener registered while modules load, i.e. before the snapshot; the kernel-side handler has to exist in every launch.
process.on("SIGUSR1", () => { console.log(`[js] SIGUSR1 handled in epoch ${Bun.startupSnapshot.epoch()}`); process.exit(0); });
Bun.startupSnapshot.main(() => {
  process.kill(process.pid, "SIGUSR1");
  setTimeout(() => { console.log("[js] handler never ran"); process.exit(1); }, 5000);
});
