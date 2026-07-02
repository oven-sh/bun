// Coverage for the fifth parameter of Bun.udpSocket's `data` callback
// (`ReceiveFlags.truncated` from MSG_TRUNC) and for Linux's IP_RECVERR
// surfacing ICMP errors as `error` events on a connected socket.

import { udpSocket } from "bun";
import { describe, expect, test } from "bun:test";
import { isLinux } from "harness";

describe("udpSocket() receive flags", () => {
  test("data callback receives flags object with truncated=false for normal packets", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const client = await udpSocket({});
    const server = await udpSocket({
      socket: {
        data(_socket, _data, _port, _address, flags) {
          resolve(flags);
        },
        error(_socket, err) {
          reject(err);
        },
      },
    });
    function sendRec() {
      if (!client.closed) {
        client.send("hello", server.port, "127.0.0.1");
        setTimeout(sendRec, 10);
      }
    }
    sendRec();
    try {
      const flags = await promise;
      expect(flags).toEqual({ truncated: false });
    } finally {
      client.close();
      server.close();
    }
  });

  // IP_RECVERR is Linux-specific. On BSDs and Windows, ICMP errors on a
  // connected UDP socket are delivered through different channels that we
  // don't currently surface.
  test.skipIf(!isLinux)(
    "surfaces ECONNREFUSED from ICMP port unreachable (IP_RECVERR) on a connected socket and keeps it open",
    async () => {
      const { promise: errPromise, resolve: resolveErr } = Promise.withResolvers<Error & { code?: string }>();

      const sender = await udpSocket({
        // Nothing is listening on port 1 of localhost, so the kernel replies
        // with ICMP port unreachable.
        connect: { hostname: "127.0.0.1", port: 1 },
        socket: {
          error(err: Error & { code?: string }) {
            resolveErr(err);
          },
        },
      });

      let gotError = false;
      function sendDead() {
        if (!gotError && !sender.closed) {
          sender.send("dead");
          setTimeout(sendDead, 10);
        }
      }
      sendDead();

      try {
        const err = await errPromise;
        gotError = true;
        expect(err?.code).toBe("ECONNREFUSED");
        // An ICMP error is one-shot, not a fatal socket state.
        expect(sender.closed).toBe(false);
      } finally {
        sender.close();
      }
    },
  );

  // An unconnected socket has no single peer to attribute an ICMP error to, so
  // Linux drops it unless IP_RECVERR is set and node relies on that. Surfacing
  // it kills processes that (per node's contract) installed no error handler,
  // and the pending error poisons the socket's next send().
  test("does not surface ICMP errors on an unconnected socket", async () => {
    const { promise: errored, reject: rejectErr } = Promise.withResolvers<never>();
    const { promise: delivered, resolve: resolveMsg } = Promise.withResolvers<string>();

    const receiver = await udpSocket({
      hostname: "127.0.0.1",
      socket: {
        data(_socket, data) {
          resolveMsg(data.toString());
        },
      },
    });

    const sender = await udpSocket({
      hostname: "127.0.0.1",
      socket: {
        error(err: Error & { code?: string }) {
          rejectErr(err);
        },
      },
    });

    function sendRec() {
      if (sender.closed || receiver.closed) return;
      try {
        sender.send("dead", 1, "127.0.0.1");
        // The ICMP reply for the datagram above is already queued by the time
        // this runs: it must not be reported as a failure of this send.
        sender.send("alive", receiver.port, "127.0.0.1");
      } catch (err) {
        rejectErr(err as Error);
        return;
      }
      setTimeout(sendRec, 10);
    }
    sendRec();

    try {
      expect(await Promise.race([delivered, errored])).toBe("alive");
    } finally {
      sender.close();
      receiver.close();
    }
  });
});
