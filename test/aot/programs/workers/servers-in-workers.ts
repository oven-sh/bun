// Three Workers each run an HTTP server (Bun.serve, node:http, Bun.serve with a WebSocket); the main thread and a fourth Worker are their clients. A server's Worker is terminated while requests are on their way, and the clients get an error, not a hang.
import { createServer } from "node:http";
type Hit = { path: string; count: number };
class Counter {
  hits = new Map<string, Hit>();
  hit(path: string): Hit {
    const hit = this.hits.get(path) ?? { path, count: 0 };
    hit.count++;
    this.hits.set(path, hit);
    return hit;
  }
}

if (Bun.isMainThread) {
  const start = (kind: string) => {
    const worker = new Worker(new URL(import.meta.url), { env: { ...process.env, KIND: kind } as any });
    return new Promise<{ worker: Worker; port: number }>(resolve => (worker.onmessage = event => resolve({ worker, port: event.data })));
  };
  const [bun, node, socket] = await Promise.all([start("bun"), start("node"), start("socket")]);
  for (const [name, { port }] of [["Bun.serve", bun], ["node:http", node]] as const) {
    const answers = await Promise.all(Array.from({ length: 50 }, (_, i) => fetch(`http://127.0.0.1:${port}/p${i % 5}`, { method: i % 2 ? "POST" : "GET", body: i % 2 ? JSON.stringify({ i }) : undefined }).then(response => response.json() as Promise<Hit & { body: string }>)));
    console.log(name, answers.length, answers.reduce((sum, hit) => Math.max(sum, hit.count), 0), answers.filter(hit => hit.body !== "").length);
  }
  const ws = new WebSocket(`ws://127.0.0.1:${socket.port}/`);
  const echoes: string[] = [];
  await new Promise<void>(resolve => {
    ws.onopen = () => { for (let i = 0; i < 5; i++) ws.send("m" + i); };
    ws.onmessage = event => void (echoes.push(String(event.data)), echoes.length === 5 && resolve());
  });
  ws.close();
  console.log("WebSocket", echoes.join());

  const client = await start("client:" + bun.port);
  console.log("a Worker as the client:", client.port);

  const slow = Array.from({ length: 10 }, () => fetch(`http://127.0.0.1:${bun.port}/slow`).then(() => "answered", () => "failed"));
  await new Promise(resolve => setTimeout(resolve, 30));
  const closed = new Promise<void>(resolve => bun.worker.addEventListener("close", () => resolve()));
  bun.worker.terminate();
  await closed;
  console.log("requests on their way when the server's Worker ended:", [...new Set(await Promise.all(slow))].join());
  console.log("behind it:", await fetch(`http://127.0.0.1:${bun.port}/`).then(() => "answered", () => "refused"));
  for (const { worker } of [node, socket, client]) worker.terminate();
} else {
  const kind = process.env.KIND!;
  const counter = new Counter();
  if (kind === "bun") {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/slow") await new Promise(() => {});
        return Response.json({ ...counter.hit(path), body: await request.text() });
      },
    });
    postMessage(server.port);
  } else if (kind === "node") {
    const server = createServer((request: any, response: any) => {
      let body = "";
      request.on("data", (chunk: unknown) => (body += chunk));
      request.on("end", () => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ...counter.hit(request.url!), body }));
      });
    });
    server.listen(0, "127.0.0.1", () => postMessage((server.address() as { port: number }).port));
  } else if (kind === "socket") {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request, server) => (server.upgrade(request) ? undefined : new Response("no", { status: 400 })),
      websocket: { message: (socket, message) => void socket.send("echo " + message) },
    });
    postMessage(server.port);
  } else {
    const port = kind.split(":")[1];
    const hits = await Promise.all(Array.from({ length: 20 }, () => fetch(`http://127.0.0.1:${port}/from-a-worker`).then(response => response.json() as Promise<Hit>)));
    postMessage(Math.max(...hits.map(hit => hit.count)));
    setInterval(() => {}, 1000);
  }
}
