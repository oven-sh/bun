const payload = Buffer.alloc(64 * 64 * 1024, "X");
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    return new Response(payload);
  },
});
console.log(server.url.href);
