// Bun.serve() at module scope while a snapshot is built: nothing binds on the build machine;
// every restored launch binds the server again, before its 'restore' listeners run.
const server = Bun.serve({
  port: 0,
  websocket: { message() {} },
  fetch(req) {
    return new Response(`first handler ${new URL(req.url).pathname}`);
  },
});
process.on("restore", async () => {
  // The bind happened before this listener ran, so the port is already real.
  console.log("[js] restore port type:", typeof server.port);
  console.log("[js] restore url:", server.url.protocol);
  const res = await fetch(`http://localhost:${server.port}/abc`);
  console.log("[js] fetch ->", res.status, await res.text());
  server.stop(true);
  process.exit(0);
});
if (Bun.startupSnapshot.isBuildingSnapshot()) {
  console.log("[js] building port:", String(server.port)); // per-launch, so unavailable: undefined
  try {
    void server.url;
    console.log("[js] building url: readable");
  } catch {
    console.log("[js] building url: throws");
  }
  console.log("[js] building publish:", server.publish("topic", "x")); // nothing is bound: 0
  console.log("[js] building subscriberCount:", server.subscriberCount("topic")); // 0
  // reload() before the snapshot updates the config the restore-time bind uses.
  server.reload({
    port: 0,
    fetch(req) {
      return new Response(`reloaded handler ${new URL(req.url).pathname}`);
    },
  });
  Bun.startupSnapshot.take({ timers: "cancel" });
}
