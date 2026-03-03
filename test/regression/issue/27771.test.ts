import { expect, test } from "bun:test";
import { createSocket, type Socket } from "node:dgram";

function bindSocket(reusePort: boolean, port?: number): Promise<{ ok: boolean; error: Error | null; socket: Socket }> {
  return new Promise(resolve => {
    const socket = createSocket({ type: "udp4", reuseAddr: true, reusePort });
    let done = false;
    const finish = (result: { ok: boolean; error: Error | null; socket: Socket }) => {
      if (done) return;
      done = true;
      resolve(result);
    };
    socket.once("error", (err: Error) => finish({ ok: false, error: err, socket }));
    socket.bind(port ?? 0, "0.0.0.0", () => finish({ ok: true, error: null, socket }));
  });
}

test("dgram reusePort: single socket binds successfully", async () => {
  const result = await bindSocket(true);
  expect(result.ok).toBe(true);
  expect(result.error).toBeNull();
  await new Promise<void>(r => result.socket.close(() => r()));
});

test("dgram reusePort: two sockets can bind to the same port", async () => {
  const a = await bindSocket(true);
  expect(a.ok).toBe(true);
  expect(a.error).toBeNull();

  const port = a.socket.address().port;

  // Bind second socket to the same port
  const b = await bindSocket(true, port);

  expect(b.ok).toBe(true);
  expect(b.error).toBeNull();

  await new Promise<void>(r => b.socket.close(() => r()));
  await new Promise<void>(r => a.socket.close(() => r()));
});
