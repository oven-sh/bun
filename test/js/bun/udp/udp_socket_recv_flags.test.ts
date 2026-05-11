// Coverage for the fifth parameter of Bun.udpSocket's `data` callback
// (`ReceiveFlags.truncated` from MSG_TRUNC) and for Linux's IP_RECVERR
// surfacing ICMP errors as `error` events on the socket.

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

  // IP_RECVERR is Linux-specific. On BSDs and Windows, ICMP errors on
  // unconnected UDP sockets either propagate by default or are delivered
  // through different channels that we don't currently surface.
  test.skipIf(!isLinux)(
    "surfaces ECONNREFUSED from ICMP port unreachable (IP_RECVERR) and keeps the socket usable",
    async () => {
      const { promise: errPromise, resolve: resolveErr } = Promise.withResolvers<Error & { code?: string }>();
      const { promise: msgPromise, resolve: resolveMsg } = Promise.withResolvers<string>();

      const receiver = await udpSocket({
        socket: {
          data(_socket, data) {
            resolveMsg(data.toString());
          },
        },
      });

      const sender = await udpSocket({
        socket: {
          error(err: Error & { code?: string }) {
            resolveErr(err);
          },
        },
      });

      // Send to a closed port on localhost. The kernel replies with ICMP
      // port unreachable; with IP_RECVERR the next recv surfaces ECONNREFUSED.
      let gotError = false;
      function sendDead() {
        if (!gotError && !sender.closed) {
          sender.send("dead", 1, "127.0.0.1");
          setTimeout(sendDead, 10);
        }
      }
      sendDead();

      try {
        const err = await errPromise;
        gotError = true;
        expect(err?.code).toBe("ECONNREFUSED");
        // The sender socket must remain usable after an ICMP error.
        expect(sender.closed).toBe(false);

        function sendAlive() {
          if (!sender.closed && !receiver.closed) {
            sender.send("alive", receiver.port, "127.0.0.1");
            setTimeout(sendAlive, 10);
          }
        }
        sendAlive();
        expect(await msgPromise).toBe("alive");
      } finally {
        sender.close();
        receiver.close();
      }
    },
  );
});
