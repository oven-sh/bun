// Reduce memory pressure by not cloning the buffer each Response.
const payload = new Blob([Buffer.alloc(64 * 64 * 1024, "X")]);

const server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  async fetch(req) {
    return new Response(payload);
  },
});
if (process.send) {
  process.send(server.url.href);
} else {
  console.log(server.url.href);
}
