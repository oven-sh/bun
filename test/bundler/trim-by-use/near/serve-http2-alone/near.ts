import http2 from "node:http2";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  http2: true,
  routes: {
    "/static": new Response("static"),
    "/users/:id": (request: any) => new Response(`user ${request.params.id}`),
  },
  fetch(request: Request) {
    return new Response(`${request.method} ${new URL(request.url).pathname} ${request.headers.get("x-name")}`);
  },
} as never);
const session = http2.connect(`http://127.0.0.1:${server.port}`);
for (const path of ["/static", "/users/1", "/other"]) {
  let text = "";
  for await (const piece of session.request({ ":path": path, "x-name": "value" })) text += piece;
  console.log(text);
}
session.close();
await server.stop(true);
