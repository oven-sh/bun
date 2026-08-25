// Fixture for #18485: a node:http response written after the client went away.
//
// The original crash: a POST handler read the whole body, then answered from a
// timer. If the client aborted between those two points, the server socket
// was freed and the late write touched it. Reading the body to its end had
// cleared the native request-body callback, and with it the user data the
// abort callback needed, so the response was never told about the abort.
//
// Part 1 reproduces that order of events exactly, once per round, with a raw
// socket: read the body, close the client, wait until the server saw the
// close, then write. Part 2 is the original load pattern, a plain node:http
// version of the express app from the report: REQUESTS POSTs with CONCURRENCY
// in flight, each aborted 1 to 6 ms after it started, each answered 1 ms after
// its body was read.
//
// Prints one JSON line with the outcome of every round and the request tally.
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

const ROUNDS = Number(process.env.ROUNDS ?? 10);
const REQUESTS = Number(process.env.REQUESTS ?? 10000);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 100);

function respondLate(res: http.ServerResponse) {
  res.statusCode = 500;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "late" }));
}

// Part 1: close after the body is read, write after the close.
let round: { client: net.Socket; connection?: net.Socket; done: (outcome: string) => void };
const closeThenWrite = http.createServer((req, res) => {
  req.on("data", () => {});
  req.on("end", async () => {
    const { client, connection, done } = round;
    const closed = once(connection!, "close");
    client.destroy();
    await closed;
    try {
      respondLate(res);
      done("wrote after close");
    } catch (e) {
      done(`threw ${(e as NodeJS.ErrnoException)?.code}`);
    }
  });
});
closeThenWrite.on("connection", connection => {
  round.connection = connection;
});
await once(closeThenWrite.listen(0, "127.0.0.1"), "listening");
const closeThenWritePort = (closeThenWrite.address() as net.AddressInfo).port;

const rounds: string[] = [];
for (let i = 0; i < ROUNDS; i++) {
  const { promise, resolve } = Promise.withResolvers<string>();
  const client = net.connect(closeThenWritePort, "127.0.0.1");
  client.on("error", () => {});
  round = { client, done: resolve };
  await once(client, "connect");
  client.write("POST /error HTTP/1.1\r\nHost: a\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
  rounds.push(await promise);
}
closeThenWrite.close();

// Part 2: the original load pattern.
const app = http.createServer((req, res) => {
  req.on("data", () => {});
  req.on("end", () => setTimeout(respondLate, 1, res));
});
await once(app.listen(0, "127.0.0.1"), "listening");
const url = `http://127.0.0.1:${(app.address() as net.AddressInfo).port}/error`;

// `aborted` counts requests the AbortController cut short. Anything else that
// fails lands in `failed` under its error name, so a reset or a refused
// connection cannot pass as an abort.
const tally = { requests: 0, handled: 0, responded: 0, aborted: 0, failed: {} as Record<string, number> };
app.on("request", () => tally.handled++);
let free = CONCURRENCY;
let slotFreed = Promise.withResolvers<void>();
const inFlight = new Set<Promise<void>>();

async function request() {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), Math.random() * 5 + 1);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: controller.signal,
    });
    await response.text();
    tally.responded++;
  } catch (e) {
    const { name, code } = e as NodeJS.ErrnoException;
    if (name === "AbortError") tally.aborted++;
    else tally.failed[code ?? name] = (tally.failed[code ?? name] ?? 0) + 1;
  }
  free++;
  slotFreed.resolve();
  slotFreed = Promise.withResolvers<void>();
}

for (let i = 0; i < REQUESTS; i++) {
  while (free === 0) await slotFreed.promise;
  free--;
  tally.requests++;
  const p = request().finally(() => inFlight.delete(p));
  inFlight.add(p);
}
// Let the last CONCURRENCY requests settle before the listener goes away, or
// close() resets the ones still in the accept queue and they never reach the
// handler.
await Promise.all(inFlight);
app.close();

console.log(JSON.stringify({ rounds, tally }));
