// The shape the deferred bind exists for: Bun.serve() at module scope, auto mode, no snapshot code
// beyond the 'restore' listener. The pending server holds no event-loop ref, so startup drains.
const server = Bun.serve({ port: 0, fetch: () => new Response("auto server ok") });
process.on("restore", async () => {
  const res = await fetch(`http://localhost:${server.port}/`);
  console.log("[js] auto serve ->", await res.text());
  server.stop(true);
  process.exit(0);
});
console.log("[js] module evaluated");
