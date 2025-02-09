const server = Bun.serve({
  hostname: "localhost",
  idleTimeout: 0,
  async fetch() {
    throw new Error("Error");
  },
  error() {
    return new Response("Hello");
  },
  port: 0,
});

const result = await fetch(`http://${server.hostname}:${server.port}`, {
  method: "GET",
}).then(res => res.text());

server.stop();
process.exit(result === "Hello" ? 0 : 1);
