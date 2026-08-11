// The first new thread in a restored process makes the allocator set up per-thread state, which walks tables the builder may
// never have touched; every mapping the builder owned has to exist after restore, resident or not.
process.on("restore", () => {
  const w = new Worker(URL.createObjectURL(new Blob(["postMessage(1)"], { type: "application/javascript" })));
  w.onmessage = () => { console.log("[js] thread started after restore"); process.exit(0); };
});
setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
