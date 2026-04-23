import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/27927
// Request passed as websocket data should retain all properties
// even if they were not accessed before server.upgrade().
test("Request passed as websocket data retains url and headers without prior access", async () => {
  type WebSocketData = { req: Request };

  let wsDataResolve: (value: { url: string; method: string; headerKeys: string[] }) => void;
  const wsDataPromise = new Promise<{ url: string; method: string; headerKeys: string[] }>(resolve => {
    wsDataResolve = resolve;
  });

  using server = Bun.serve({
    port: 0,
    fetch(req, server) {
      // Intentionally do NOT access req.url or req.headers before upgrade
      server.upgrade(req, {
        data: { req },
      });
      return undefined;
    },
    websocket: {
      data: {} as WebSocketData,
      message(ws) {
        const req = ws.data.req;
        wsDataResolve({
          url: req.url,
          method: req.method,
          headerKeys: [...req.headers.keys()],
        });
        ws.close();
      },
    },
  });

  const ws = new WebSocket(`ws://localhost:${server.port}/test-path`);

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
      ws.send("hello");
    };
    ws.onclose = () => resolve();
    ws.onerror = err => reject(err);
  });

  const data = await wsDataPromise;

  expect(data.url).toBe(`http://localhost:${server.port}/test-path`);
  expect(data.method).toBe("GET");
  expect(data.headerKeys).toContain("host");
  expect(data.headerKeys).toContain("upgrade");
  expect(data.headerKeys).toContain("sec-websocket-key");
});
