// Passes a FIFO that never gets a writer as a TLS file option through every
// door, one after another, and prints one JSON line per door with the error
// that door produced. Every door must throw or reject at once: a blocking
// open(2) of the FIFO would freeze this process at that door.
import https from "node:https";
import tls from "node:tls";

const fifo = process.env.FIFO!;
const file = () => Bun.file(fifo);
const fetchHandler = () => new Response("ok");

const doors: Record<string, () => unknown> = {
  "Bun.serve": () => Bun.serve({ port: 0, tls: { key: file(), cert: file() }, fetch: fetchHandler }),
  "Bun.serve sni": () =>
    Bun.serve({ port: 0, tls: [{ key: file(), cert: file(), serverName: "a.example.com" }], fetch: fetchHandler }),
  "Bun.serve keyFile": () => Bun.serve({ port: 0, tls: { keyFile: fifo, certFile: fifo }, fetch: fetchHandler }),
  "server.reload": () => {
    const server = Bun.serve({ port: 0, fetch: fetchHandler });
    try {
      server.reload({ tls: { key: file(), cert: file() }, fetch: fetchHandler });
    } finally {
      server.stop(true);
    }
  },
  "Bun.listen": () =>
    Bun.listen({ hostname: "127.0.0.1", port: 0, tls: { key: file(), cert: file() }, socket: { data() {} } }),
  "Bun.listen keyFile": () =>
    Bun.listen({ hostname: "127.0.0.1", port: 0, tls: { keyFile: fifo, certFile: fifo }, socket: { data() {} } }),
  "Bun.connect": () => Bun.connect({ hostname: "127.0.0.1", port: 1, tls: { ca: file() }, socket: { data() {} } }),
  fetch: () => fetch("https://127.0.0.1:1/", { tls: { ca: file() } }),
  "tls.connect": () =>
    new Promise((_, reject) => tls.connect({ host: "127.0.0.1", port: 1, ca: file() }).on("error", reject)),
  "tls.createServer": () =>
    new Promise((_, reject) => tls.createServer({ key: file(), cert: file() }).on("error", reject).listen(0)),
  "tls.createSecureContext": () => tls.createSecureContext({ ca: file() }),
  "https.Agent": () =>
    new Promise((_, reject) =>
      https.get("https://127.0.0.1:1/", { agent: new https.Agent({ ca: file() }) }, () => {}).on("error", reject),
    ),
  WebSocket: () =>
    new Promise((_, reject) => {
      const ws = new WebSocket("wss://127.0.0.1:1/", { tls: { ca: file() } });
      ws.onerror = event => reject((event as ErrorEvent).error ?? event);
    }),
  RedisClient: () => new Bun.RedisClient("rediss://127.0.0.1:1", { tls: { ca: file() } }),
  "Bun.SQL": () => {
    const sql = new Bun.SQL("postgres://user:pass@127.0.0.1:1/db?sslmode=require", { tls: { ca: file() }, max: 1 });
    return sql`select 1`;
  },
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String((error as any)?.message ?? error);

// An error thrown from a callback or a next tick belongs to the door that is
// running at the time. One that arrives after its door already reported is a
// stray, printed at the end so that the test fails on it.
let settle: ((error: unknown) => void) | undefined;
const stray: string[] = [];
const onLateError = (error: unknown) => (settle ? settle(error) : stray.push(messageOf(error)));
process.on("uncaughtException", onLateError);
process.on("unhandledRejection", onLateError);

for (const [door, run] of Object.entries(doors)) {
  const { promise, resolve } = Promise.withResolvers<unknown>();
  settle = error => {
    settle = undefined;
    resolve(error);
  };
  try {
    Promise.resolve(run()).then(() => settle?.("no error"), error => onLateError(error));
  } catch (error) {
    settle?.(error);
  }
  console.log(JSON.stringify({ door, message: messageOf(await promise) }));
}
// Let anything still queued from the last door surface before reporting strays.
await new Promise(resolve => setImmediate(resolve));
console.log(JSON.stringify({ stray }));
process.exit(0);
