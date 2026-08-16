// server.stop() before the snapshot drops the pending entry: only the kept server binds at restore.
const kept = Bun.serve({ port: 0, fetch: () => new Response("kept") });
const dropped = Bun.serve({ port: 0, fetch: () => new Response("dropped") });
dropped.stop(); // graceful: still drops the never-bound entry
process.on("restore", async () => {
  const res = await fetch(`http://localhost:${kept.port}/`);
  console.log("[js] kept ->", await res.text());
  console.log("[js] dropped port:", String(dropped.port)); // never bound: the configured port (0)
  kept.stop(true);
  process.exit(0);
});
if (Bun.startupSnapshot.isBuildingSnapshot()) Bun.startupSnapshot.take({ timers: "cancel" });
