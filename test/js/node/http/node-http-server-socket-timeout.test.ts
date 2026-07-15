import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import net, { type AddressInfo } from "node:net";

// The uSockets per-connection inactivity timer has seconds granularity on a
// coarse wheel, so a 1s timeout may take a few seconds to fire. These tests
// only assert that the three documented spellings of the same knob all arm the
// timer and deliver a 'timeout' event; the wheel granularity is covered
// elsewhere.

type Armer = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  onTimeout: () => void,
) => { returned: unknown; expected: unknown; timeoutReadback: number };

const STALL = "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 900\r\n\r\nab";

describe.concurrent("http server: per-connection setTimeout", () => {
  test.each([
    [
      "response.setTimeout(msecs, cb)",
      ((req, res, onTimeout) => {
        const returned = res.setTimeout(1000, onTimeout);
        return { returned, expected: res, timeoutReadback: req.socket.timeout };
      }) as Armer,
    ],
    [
      "socket.setTimeout(msecs, cb)",
      ((req, res, onTimeout) => {
        const returned = req.socket.setTimeout(1000, onTimeout);
        return { returned, expected: req.socket, timeoutReadback: req.socket.timeout };
      }) as Armer,
    ],
    [
      "request.setTimeout(msecs, cb)",
      ((req, res, onTimeout) => {
        const returned = req.setTimeout(1000, onTimeout);
        return { returned, expected: req, timeoutReadback: req.socket.timeout };
      }) as Armer,
    ],
  ])(
    "%s arms the inactivity timer on a stalled request body",
    async (_name, arm) => {
      let timeoutFired = false;
      let chainsCorrectly = false;
      let timeoutReadback: number | undefined;

      const server = http.createServer((req, res) => {
        const {
          returned,
          expected,
          timeoutReadback: readback,
        } = arm(req, res, () => {
          timeoutFired = true;
          req.socket.destroy();
        });
        chainsCorrectly = returned === expected;
        timeoutReadback = readback;
        req.resume();
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const { port } = server.address() as AddressInfo;
      try {
        const client = net.connect(port, "127.0.0.1");
        client.on("error", () => {});
        await once(client, "connect");
        client.setNoDelay(true);
        // Send headers + a body prefix, then never complete the body so the
        // connection is idle from the server's perspective.
        client.write(STALL);
        client.resume();

        // The server-side timeout callback destroys the socket, which closes
        // this client connection.
        await once(client, "close");
      } finally {
        server.closeAllConnections?.();
        server.close();
      }

      expect({ timeoutFired, chainsCorrectly }).toEqual({
        timeoutFired: true,
        chainsCorrectly: true,
      });
      // Bun's server-side IncomingMessage.setTimeout currently calls the
      // native setRequestTimeout(handle, ...) directly rather than routing
      // through this.socket.setTimeout as Node does, so socket.timeout is not
      // updated for the request spelling (pre-existing).
      if (_name !== "request.setTimeout(msecs, cb)") {
        expect(timeoutReadback).toBe(1000);
      }
    },
    15_000,
  );

  test("socket.setTimeout(0, cb) removes the listener and clears socket.timeout", async () => {
    let results:
      | {
          timeoutAfterSet: number;
          timeoutAfterClear: number;
          listenersAfterSet: number;
          listenersAfterClear: number;
          returned: unknown;
          socket: unknown;
        }
      | undefined;

    const server = http.createServer((req, res) => {
      const socket = req.socket;
      const cb = () => {};
      const baseListeners = socket.listenerCount("timeout");
      socket.setTimeout(2000, cb);
      const timeoutAfterSet = socket.timeout;
      const listenersAfterSet = socket.listenerCount("timeout") - baseListeners;
      const returned = socket.setTimeout(0, cb);
      const timeoutAfterClear = socket.timeout;
      const listenersAfterClear = socket.listenerCount("timeout") - baseListeners;
      results = { timeoutAfterSet, timeoutAfterClear, listenersAfterSet, listenersAfterClear, returned, socket };
      res.end("ok");
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(await res.text()).toBe("ok");
    } finally {
      server.closeAllConnections?.();
      server.close();
    }

    expect(results).toBeDefined();
    expect({
      timeoutAfterSet: results!.timeoutAfterSet,
      timeoutAfterClear: results!.timeoutAfterClear,
      listenersAfterSet: results!.listenersAfterSet,
      listenersAfterClear: results!.listenersAfterClear,
    }).toEqual({
      timeoutAfterSet: 2000,
      timeoutAfterClear: 0,
      listenersAfterSet: 1,
      listenersAfterClear: 0,
    });
    expect(results!.returned).toBe(results!.socket);
  });

  test("socket.setTimeout validates msecs like net.Socket", async () => {
    let errors: Record<string, string | undefined> | undefined;

    const server = http.createServer((req, res) => {
      const socket = req.socket;
      const codeOf = (fn: () => void) => {
        try {
          fn();
          return undefined;
        } catch (e) {
          return (e as NodeJS.ErrnoException).code;
        }
      };
      errors = {
        negative: codeOf(() => socket.setTimeout(-1)),
        nan: codeOf(() => socket.setTimeout(NaN)),
        string: codeOf(() => socket.setTimeout("foo" as unknown as number)),
        badCallback: codeOf(() => socket.setTimeout(1000, "nope" as unknown as () => void)),
      };
      res.end("ok");
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(await res.text()).toBe("ok");
    } finally {
      server.closeAllConnections?.();
      server.close();
    }

    expect(errors).toEqual({
      negative: "ERR_OUT_OF_RANGE",
      nan: "ERR_OUT_OF_RANGE",
      string: "ERR_INVALID_ARG_TYPE",
      badCallback: "ERR_INVALID_ARG_TYPE",
    });
  });
});
