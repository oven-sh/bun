import handler from "./dist/server/server.js";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  fetch: (request: Request) => handler.fetch(request),
});

console.log("listening", server.port);
