import bodyParser from "body-parser";
import express from "express";
import fastify from "fastify";
import http, { type IncomingMessage, type RequestListener, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

interface Observation {
  route: string;
  dispatcher: string;
  res: ServerResponse;
  ticks: string[];
}

const observations: Observation[] = [];
const nextTick = process.nextTick;
process.nextTick = function (callback: Function, ...args: unknown[]) {
  const latest = observations.at(-1);
  if (latest && !latest.res.closed) latest.ticks.push(callback.name);
  return nextTick.call(process, callback, ...args);
} as typeof process.nextTick;

function observing(listener: RequestListener): RequestListener {
  return (req, res) => {
    const frames = new Error().stack!.split("\n").map(line => /at (\S+)/.exec(line)?.[1] ?? "");
    observations.push({
      route: `${req.method} ${req.url}`,
      dispatcher: frames.find(frame => frame.startsWith("dispatch")) ?? "unknown",
      res,
      ticks: [],
    });
    listener(req, res);
  };
}

function expressApplication(withMiddleware: boolean) {
  const app = express();
  if (withMiddleware) {
    app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
      res.on("finish", () => {});
      next();
    });
    app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
      for (const [name, value] of [
        ["Content-Security-Policy", "default-src 'self'"],
        ["Cross-Origin-Opener-Policy", "same-origin"],
        ["Referrer-Policy", "no-referrer"],
        ["Strict-Transport-Security", "max-age=15552000"],
        ["X-Content-Type-Options", "nosniff"],
        ["X-Frame-Options", "SAMEORIGIN"],
        ["Access-Control-Allow-Origin", "*"],
      ]) {
        res.setHeader(name, value);
      }
      res.removeHeader("X-Powered-By");
      next();
    });
    app.use(bodyParser.json());
  }
  app.get("/text", (req: any, res: any) => res.send("hello"));
  app.get("/json", (req: any, res: any) => res.json({ a: 1 }));
  app.get("/users/:id", (req: any, res: any) => res.json({ id: req.params.id }));
  app.get("/redirect", (req: any, res: any) => res.redirect("/text"));
  app.post("/echo", withMiddleware ? [] : bodyParser.json(), (req: any, res: any) => res.json(req.body));
  return app;
}

async function createServer(stack: string): Promise<Server> {
  switch (stack) {
    case "node:http":
      return http.createServer(
        observing((req, res) => {
          if (req.method === "POST") {
            const chunks: Buffer[] = [];
            req.on("data", chunk => chunks.push(chunk));
            req.on("end", () => {
              res.setHeader("Content-Type", "application/json");
              res.end(Buffer.concat(chunks));
            });
          } else if (req.url === "/text") {
            res.end("hello");
          } else if (req.url === "/redirect") {
            res.writeHead(302, { Location: "/text" });
            res.end();
          } else if (req.url === "/missing") {
            res.statusCode = 404;
            res.end("not found");
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"a":1}');
          }
        }),
      );
    case "express":
      return http.createServer(observing(expressApplication(false)));
    case "express with middleware":
      return http.createServer(observing(expressApplication(true)));
    case "fastify": {
      const app = fastify({ serverFactory: handler => http.createServer(observing(handler)) });
      app.get("/text", async () => "hello");
      app.get("/json", async () => ({ a: 1 }));
      app.get("/users/:id", async (request: any) => ({ id: request.params.id }));
      app.get("/redirect", (request, reply) => reply.redirect("/text"));
      app.post("/echo", async request => request.body);
      await app.ready();
      return app.server;
    }
  }
  throw new Error("unknown stack " + stack);
}

function outgoingHeaders(res: ServerResponse) {
  return (res as any)[Object.getOwnPropertySymbols(res).find(symbol => symbol.description === "kOutHeaders")!];
}

const server = await createServer(process.argv[2]);

process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  server.close(() => {
    const coverage: Record<string, Record<string, number>> = {};
    for (const { route, dispatcher, res, ticks } of observations) {
      const counts = (coverage[route] ??= { requests: 0, fastDispatch: 0, compactHeaders: 0, singleTickFinish: 0 });
      counts.requests++;
      if (dispatcher === "dispatchUsualRequest") counts.fastDispatch++;
      if (outgoingHeaders(res) === null) counts.compactHeaders++;
      if (ticks.at(-1) === "finishExchange") counts.singleTickFinish++;
    }
    console.log(JSON.stringify(coverage));
  });
});

server.listen(0, "127.0.0.1", () => console.log((server.address() as AddressInfo).port));
