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
        const { returned, expected, timeoutReadback: readback } = arm(req, res, () => {
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
      // Node.js writes back the msecs value to socket.timeout for the socket
      // and response spellings (request.setTimeout does not forward to the
      // socket in Node, so that entry is allowed to read 0).
      if (_name !== "request.setTimeout(msecs, cb)") {
        expect(timeoutReadback).toBe(1000);
      }
    },
    15_000,
  );

  test("socket.setTimeout(0, cb) removes the listener and clears socket.timeout", async () => {
    let results: { timeoutAfterSet: number; timeoutAfterClear: number; returned: unknown; socket: unknown } | undefined;

    const server = http.createServer((req, res) => {
      const socket = req.socket;
      const cb = () => {};
      socket.setTimeout(2000, cb);
      const timeoutAfterSet = socket.timeout;
      const returned = socket.setTimeout(0, cb);
      const timeoutAfterClear = socket.timeout;
      results = { timeoutAfterSet, timeoutAfterClear, returned, socket };
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
    expect(results!.timeoutAfterSet).toBe(2000);
    expect(results!.timeoutAfterClear).toBe(0);
    expect(results!.returned).toBe(results!.socket);
  });
});
