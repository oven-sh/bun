import { once } from "node:events";
import { createServer } from "node:http";
import { test, expect } from "bun:test";
import { gc } from "harness";

test("do not leak", async () => {
  await using server = createServer((req, res) => {
    res.end();
  }).listen(0);
  await once(server, "listening");

  let url;
  let isDone = false;
  server.listen(0, function attack() {
    if (isDone) {
      return;
    }
    url ??= new URL(`http://127.0.0.1:${server.address().port}`);
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(res => res.arrayBuffer())
      .catch(() => {})
      .then(attack);
  });

  let prev = Infinity;
  let count = 0;
  const interval = setInterval(() => {
    isDone = true;
    gc();
    const next = process.memoryUsage().heapUsed;
    if (next <= prev) {
      expect(true).toBe(true);
      clearInterval(interval);
    } else if (count++ > 20) {
      clearInterval(interval);
      expect.unreachable();
    } else {
      prev = next;
    }
  }, 1e3);
});
