import { expect, test } from "bun:test";
import { WebSocket, WebSocketServer } from "ws";

// Matches the npm "ws" package: terminate() reads instance state from `this`,
// so a detached call must throw rather than silently return.
test("server WebSocket terminate() throws TypeError when called without a receiver", async () => {
  const wss = new WebSocketServer({ port: 0 });
  const { resolve, reject, promise } = Promise.withResolvers<void>();

  wss.on("connection", ws => {
    try {
      const terminate = ws.terminate;
      expect(() => terminate()).toThrow(TypeError);
      expect(() => ws.terminate.call(undefined)).toThrow(TypeError);
      // The bound call that frameworks actually make (e.g. next dev shutdown) must keep working.
      expect(() => ws.terminate()).not.toThrow();
      resolve();
    } catch (err) {
      reject(err);
    } finally {
      wss.close();
    }
  });

  new WebSocket("ws://localhost:" + wss.address().port);
  await promise;
});
