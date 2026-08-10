// Whether TLS certificates are verified is derived lazily from the environment; a value derived in the builder must not
// survive into a launch whose environment says otherwise. The build runs with verification off, the launch with it on.
const tls = { cert: Bun.file(process.env.TLS_CERT), key: Bun.file(process.env.TLS_KEY) };
async function probe(label) {
  const server = Bun.serve({ port: 0, tls, fetch: () => new Response("ok") });
  try {
    const r = await fetch(`https://localhost:${server.port}/`);
    console.log(`[js] ${label} ok ${r.status}`);
  } catch (e) {
    console.log(`[js] ${label} rejected ${e.code ?? e.name}`);
  } finally {
    server.stop(true);
  }
}
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // written from JS as well as inherited: both places it can be latched from
await probe("build");
process.on("restore", async () => {
  await probe("restored");
  process.exit(0);
});
setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 50);
