// Bun.serve on 127.0.0.1: routes, parameters, a static response, a stream, a file, an error, a WebSocket, stop
import { tmpdir } from "node:os";
import { join } from "node:path";
const path = join(tmpdir(), `serve-use-${process.pid}.txt`);
await Bun.write(path, "from a file");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: {
    "/static": new Response("static", { headers: { "x-kind": "static" } }),
    "/users/:id": (request: any) => Response.json({ id: request.params.id, method: request.method }),
    "/file": () => new Response(Bun.file(path)),
  },
  async fetch(request: Request, server: any) {
    const url = new URL(request.url);
    if (url.pathname === "/ws")
      return server.upgrade(request, { data: { name: "w" } }) ? undefined : new Response("no upgrade", { status: 400 });
    if (url.pathname === "/stream")
      return new Response(
        new ReadableStream({
          start(controller: any) {
            controller.enqueue("a");
            controller.enqueue("b");
            controller.close();
          },
        }),
      );
    if (url.pathname === "/echo") return new Response((await request.text()).toUpperCase(), { status: 201 });
    if (url.pathname === "/throw") throw new Error("boom");
    return new Response("not found", { status: 404 });
  },
  error(error: Error) {
    return new Response("caught " + error.message, { status: 500 });
  },
  websocket: {
    message(socket: any, message: any) {
      socket.send(`${socket.data.name}:${message}`);
      socket.close();
    },
  },
});
const base = `http://127.0.0.1:${server.port}`;
for (const [url, init] of [
  ["/static"],
  ["/users/7"],
  ["/file"],
  ["/stream"],
  ["/echo", { method: "POST", body: "hi" }],
  ["/throw"],
  ["/none"],
] as [string, any][]) {
  const response = await fetch(base + url, init);
  console.log(url, response.status, await response.text(), response.headers.get("x-kind") ?? "");
}
const answered = Promise.withResolvers<string>();
const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
socket.onopen = () => socket.send("ping");
socket.onmessage = (event: any) => answered.resolve(String(event.data));
console.log(await answered.promise, server.hostname, typeof server.pendingRequests, server.development);
await server.stop(true);
await Bun.file(path).delete();
console.log("stopped");
