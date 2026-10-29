// Reloads a server with websocket handlers many times and prints how much RSS grew after a warmup.
const rss =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;
const reloads = parseInt(process.env.RELOADS || "400", 10);
const warmup = parseInt(process.env.WARMUP || "1000", 10);
const routeCount = parseInt(process.env.ROUTES || "12", 10);

const routes: Record<string, () => Response> = {};
for (let i = 0; i < routeCount; i++) routes[`/r${i}/:id`] = () => new Response("r");

const config = (i: number) => ({
  port: 0,
  hostname: "127.0.0.1",
  routes,
  fetch(req: Request, server: Bun.Server<undefined>) {
    if (server.upgrade(req)) return;
    return new Response("f" + i);
  },
  websocket: {
    message(ws: Bun.ServerWebSocket, message: string | Buffer) {
      ws.send(message);
    },
  },
});

using server = Bun.serve(config(0));

for (let i = 1; i <= warmup; i++) server.reload(config(i));
Bun.gc(true);
const baseline = rss();

for (let i = 1; i <= reloads; i++) server.reload(config(i));
Bun.gc(true);
const final = rss();

console.log(
  JSON.stringify({ reloads, routeCount, deltaMiB: Math.round(((final - baseline) / 1024 / 1024) * 10) / 10 }),
);
