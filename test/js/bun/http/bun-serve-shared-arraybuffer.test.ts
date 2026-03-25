import { test, expect } from "bun:test";

test("SharedArrayBuffer-backed TypedArray as ALPNProtocols does not crash", () => {
  const shared = new SharedArrayBuffer(16);
  const view = new Int16Array(shared);
  expect(() => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ok");
      },
      ALPNProtocols: view,
    });
  }).toThrow(TypeError);
});
