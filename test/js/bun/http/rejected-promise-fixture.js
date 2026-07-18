const server = Bun.serve({
  // 127.0.0.1, not "localhost": on v6-preferring hosts serve() binds ::1 while
  // fetch() resolves localhost to 127.0.0.1 → ConnectionRefused.
  hostname: "127.0.0.1",
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
