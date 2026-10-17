import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  catalog,
  exportProducts,
  invalidOrder,
  placeCheckedOrder,
  placeOrder,
  placeTypedOrder,
  postPage,
  summarize,
  type OrderBody,
} from "./shared";

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const parts = url.pathname.split("/");
  if (req.method === "GET") {
    if (url.pathname === "/text") {
      res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": 13 });
      res.end("Hello, World!");
      return;
    }
    if (url.pathname === "/json") return sendJson(res, 200, catalog(42));
    if (parts.length === 5 && parts[1] === "users" && parts[3] === "posts") {
      const query = url.searchParams;
      return sendJson(res, 200, postPage(parts[2]!, parts[4]!, query.get("page"), query.get("limit"), query.get("sort")));
    }
    if (parts.length === 3 && parts[1] === "async") return sendJson(res, 200, await summarize(Number(parts[2])));
    if (url.pathname === "/stream") {
      res.writeHead(200, { "Content-Type": "text/csv" });
      for await (const chunk of exportProducts()) res.write(chunk);
      res.end();
      return;
    }
  }
  if (req.method === "POST" && parts.length === 4 && parts[1] === "shops") {
    if (parts[3] === "orders") {
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return sendJson(res, 400, invalidOrder);
      }
      const receipt = placeOrder(parts[2]!, body);
      return receipt ? sendJson(res, 200, receipt) : sendJson(res, 400, invalidOrder);
    }
    if (parts[3] === "checked-orders") {
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return sendJson(res, 400, invalidOrder);
      }
      const receipt = placeCheckedOrder(parts[2]!, body);
      return receipt ? sendJson(res, 200, receipt) : sendJson(res, 400, invalidOrder);
    }
    if (parts[3] === "typed-orders") {
      try {
        const order = JSON.parse(await readBody(req)) as OrderBody;
        const receipt = placeTypedOrder(parts[2]!, order);
        return receipt ? sendJson(res, 200, receipt) : sendJson(res, 400, invalidOrder);
      } catch {
        return sendJson(res, 400, invalidOrder);
      }
    }
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
}

const server = createServer((req, res) => {
  handle(req, res).catch(() => {
    res.writeHead(500);
    res.end();
  });
});

server.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () => {
  console.log("listening", (server.address() as AddressInfo).port);
});
