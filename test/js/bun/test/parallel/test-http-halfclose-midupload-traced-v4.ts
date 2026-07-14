// The 127.0.0.1 sibling of test-http-halfclose-midupload-traced.ts: same
// scenario, same runner phase, explicit IPv4. If this passes while the
// localhost sibling stalls in the same 2-wide phase, the family matters only
// under concurrency; if both stall, it is pure loopback collision.
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
const watchdog = setTimeout(() => {
  fs.writeSync(2, `WATCHDOG: stalled after: ${steps.join(" -> ")}\n`);
  fs.writeSync(2, `WATCHDOG: server connections=${(server as any)?._connections}\n`);
  process.exit(1);
}, 15_000);
watchdog.unref?.();

const { promise, resolve, reject } = Promise.withResolvers();

await using server = http.createServer((req, res) => {
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
await once(server.listen(0, "127.0.0.1"), "listening");
step("listening");
const url = `http://127.0.0.1:${server.address().port}`;

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
