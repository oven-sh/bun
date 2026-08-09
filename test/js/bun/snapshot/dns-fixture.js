const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
await fetch(`http://localhost:${server.port}/`).then(r => r.text()); // warms the getaddrinfo cache for "localhost" in the builder
console.log("[js] build", JSON.stringify(Bun.dns.getCacheStats()));
process.on("restore", async () => {
  const before = Bun.dns.getCacheStats();
  const s2 = Bun.serve({ port: 0, fetch: () => new Response("ok2") });
  const r = await fetch(`http://localhost:${s2.port}/`);
  console.log("[js] restored", JSON.stringify({ before, after: Bun.dns.getCacheStats(), status: r.status, body: await r.text() }));
  process.exit(0);
});
setTimeout(() => { server.stop(true); Bun.unsafe.snapshot({ timers: "cancel" }); }, 100);
