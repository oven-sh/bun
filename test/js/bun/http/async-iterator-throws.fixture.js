const server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  error(e) {
    return new Response("E:" + e.message, { status: 555 });
  },

  async fetch(req) {
    return new Response(
      async function* () {
        throw new Error("Oops");
      },
      {
        headers: {
          "X-Hey": "123",
        },
      },
    );
  },
});

process.send(`${server.url}`);
