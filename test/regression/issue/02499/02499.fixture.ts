const server = Bun.serve({
  port: 0,
  async fetch(req) {
    console.log(await req.json());
    return new Response();
  },
});
console.log(
  JSON.stringify({
    hostname: server.hostname,
    port: server.port,
  }),
);

(async function () {
  for await (let line of console) {
    if (line === "--CLOSE--") {
      process.exit(0);
    }
  }
})();
