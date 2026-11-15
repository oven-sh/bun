const server = Bun.serve({
  port: 0,
  fetch() {
    return new Response("plain");
  },
});
console.log("" + server.protocol + " " + String(server.url).startsWith("http://"));
server.reload({
  fetch() {
    return new Response("still plain");
  },
  tls: { serverName: "example.com", rejectUnauthorized: false },
} as never);
console.log("" + server.protocol + " " + String(server.url).startsWith("http://"));
await server.stop(true);
console.log("stopped");
