// Verbatim shape of test-http-should-not-emit-or-throw-error-when-writing-
// after-socket.end.ts, which times out silently (three 20s attempts, zero
// output) on the Windows agents while semantically-equivalent bun:test twins
// pass on the same machines - the delta is this runner phase (plain script,
// 2-wide parallel on Windows). Only stderr breadcrumbs and a 15s watchdog
// are added so the stall names its stage before the runner's silent kill.
import { createTest } from "node-harness";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
const { expect } = createTest(import.meta.path);

const steps: string[] = [];
// writeSync(2): the runner kills stalled processes hard, and console.error's
// async pipe writes (and process.exit's pending buffers) get lost - the first
// CI round captured the step ladder but never the watchdog line.
const step = (s: string) => {
  steps.push(s);
  fs.writeSync(2, `STEP: ${s}\n`);
};
// REF'D ticker, not an unref'd timeout: round 2 showed zero watchdog output
// despite fs.writeSync - an unref'd 15s timer never fired inside a 20s
// stall, so either unref'd timers cannot wake a socket-waiting loop here or
// the loop is wedged in an infinite poll. A ref'd 5s ticker discriminates:
// TICK lines during the stall = loop turns, missing socket event; no TICK
// lines = the event loop itself is wedged.
let ticks = 0;
const ticker = setInterval(() => {
  ticks++;
  fs.writeSync(2, `TICK ${ticks}: after: ${steps.join(" -> ")} connections=${(server as any)?._connections}\n`);
  if (ticks >= 3) {
    fs.writeSync(2, `WATCHDOG: stalled\n`);
    process.exit(1);
  }
}, 5_000);

const { promise, resolve, reject } = Promise.withResolvers();

const server = http.createServer((req, res) => {
  step("request-received");
  req.socket.on("close", () => step("server-conn-close"));
  req.socket.on("error", (e: any) => step(`server-conn-error:${e.code}`));
  req.socket.on("end", () => step("server-conn-end"));
  res.writeHead(200, { "Connection": "close" });

  res.socket.end();
  step("socket-ended");
  res.on("error", reject);
  try {
    const result = res.write("Hello, world!");
    step("write-returned");
    resolve(result);
  } catch (err) {
    reject(err);
  }
});
await once(server.listen(0), "listening");
step("listening");
const url = `http://localhost:${server.address().port}`;

await fetch(url, {
  method: "POST",
  body: Buffer.allocUnsafe(1024 * 1024 * 10),
})
  .then(res => res.bytes())
  .catch(err => {});
step("fetch-settled");

expect(await promise).toBeTrue();
step("write-result-true");
step("disposing-server");
await (server as any)[Symbol.asyncDispose]();
step("server-disposed");
clearInterval(ticker);
