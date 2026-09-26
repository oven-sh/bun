import { describe, expect, it } from "bun:test";
import { isWindows, tmpdirSync } from "harness";
import { connect, createConnection, createServer } from "node:net";
import { join } from "node:path";

// The lookup-result to connect step mirrors node's TCPWrap/PipeWrap: the
// address must parse in the family the lookup named, and a pipe connect
// failure is reported on the next loop turn. The one-connect-per-handle
// (EALREADY) cases are in socket-reconnect-live.test.ts.
describe.concurrent("connect step semantics", () => {
  const socketDir = tmpdirSync();

  async function listenCounting() {
    let connections = 0;
    const server = createServer(c => {
      connections++;
      c.on("error", () => {});
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as import("node:net").AddressInfo).port;
    return { server, port, connections: () => connections };
  }

  it("an address that does not parse in the looked-up family fails with EINVAL and opens no connection", async () => {
    const { server, port, connections } = await listenCounting();
    try {
      const err = await new Promise<NodeJS.ErrnoException>(resolve => {
        const c = connect({
          host: "example.invalid",
          port,
          autoSelectFamily: false,
          lookup(_host, _opts, cb) {
            cb(null, "127.0.0.1", 6);
          },
        });
        c.on("error", resolve);
        c.on("connect", () => {
          c.destroy();
          resolve(Object.assign(new Error("connected"), { code: "CONNECTED" }));
        });
      });
      expect(err.code).toBe("EINVAL");
      expect(err.syscall).toBe("connect");
      // Wait one loop turn so a dispatched connect would have reached the server.
      await new Promise(resolve => setImmediate(resolve));
      expect(connections()).toBe(0);
    } finally {
      server.close();
    }
  });

  it.skipIf(isWindows)("a failed pipe connect reports its error after callbacks queued at connect()", async () => {
    const missing = join(socketDir, "connect-step-missing.sock");
    const result = await new Promise<{ code: string | undefined; tickRan: boolean }>(resolve => {
      const c = createConnection(missing);
      let tickRan = false;
      process.nextTick(() => {
        tickRan = true;
      });
      c.on("error", e => resolve({ code: (e as NodeJS.ErrnoException).code, tickRan }));
      c.on("connect", () => {
        c.destroy();
        resolve({ code: "CONNECTED", tickRan });
      });
    });
    expect(result).toEqual({ code: "ENOENT", tickRan: true });
  });

  it.skipIf(isWindows)(
    "a failed pipe connect does not fail a reconnect issued before its error is reported",
    async () => {
      const { server, port } = await listenCounting();
      try {
        const missing = join(socketDir, "connect-step-missing-reconnect.sock");
        const events: string[] = [];
        await new Promise<void>(resolve => {
          const c = createConnection(missing);
          c.on("error", e => {
            events.push("error:" + (e as NodeJS.ErrnoException).code);
            resolve();
          });
          c.on("connect", () => {
            events.push("connect");
            c.destroy();
            resolve();
          });
          c.destroy();
          c.connect(port, "127.0.0.1");
        });
        expect(events).toEqual(["connect"]);
      } finally {
        server.close();
      }
    },
  );
});
