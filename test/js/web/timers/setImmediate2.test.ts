import { test, expect } from "bun:test";

test("setImmediate doesn't block the event loop", async () => {
  const incomingTimestamps = [];
  var hasResponded = false;
  var expectedTime = "";
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      await new Promise(resolve => setTimeout(resolve, 50).unref());
      function queuey() {
        incomingTimestamps.push(Date.now());
        if (!hasResponded) setImmediate(queuey);
      }
      setImmediate(queuey);
      return new Response((expectedTime = Date.now().toString(10)));
    },
  });

  const resp = await fetch(`http://${server.hostname}:${server.port}/`);
  expect(await resp.text()).toBe(expectedTime);
  hasResponded = true;
  server.stop(true);
});
