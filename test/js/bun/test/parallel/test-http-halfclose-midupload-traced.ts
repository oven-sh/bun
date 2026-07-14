// Verbatim shape of test-http-should-not-emit-or-throw-error-when-writing-
// after-socket.end.ts, which times out silently (three 20s attempts, zero
// output) on the Windows agents while semantically-equivalent bun:test twins
// pass on the same machines - the delta is this runner phase (plain script,
// 2-wide parallel on Windows). Only stderr breadcrumbs and a 15s watchdog
// are added so the stall names its stage before the runner's silent kill.
import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

const steps: string[] = [];
const step = (s: string) => {
  steps.push(s);
  console.error("STEP:", s);
};
const watchdog = setTimeout(() => {
  console.error("WATCHDOG: stalled after:", steps.join(" -> "));
  process.exit(1);
}, 15_000);
watchdog.unref?.();

const { promise, resolve, reject } = Promise.withResolvers();

await using server = http.createServer((req, res) => {
  step("request-received");
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
