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
      expect(flags).toEqual({ truncated: false, ipv6: false });
    } finally {
      client.close();
      server.close();
    }
  });

  // IP_RECVERR is Linux-specific. On BSDs and Windows, ICMP errors on
  // unconnected UDP sockets are not queued by the kernel at all. The
  // I/O-after-ICMP round-trip is covered by the reply-server test in
  // udp_socket.test.ts; Bun.udpSocket exposes no public reconnect to
  // exercise it on the connected path.
  test.skipIf(!isLinux)(
    "connected socket surfaces ECONNREFUSED from ICMP port unreachable and stays open",
    async () => {
      const { promise: errPromise, resolve: resolveErr } = Promise.withResolvers<Error & { code?: string }>();

      // Bind then close a probe so the port is known-dead.
      const probe = await udpSocket({});
      const deadPort = probe.port;
      probe.close();

      const sender = await udpSocket({
        connect: { hostname: "127.0.0.1", port: deadPort },
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
        expect(sender.closed).toBe(false);
      } finally {
        sender.close();
      }
    },
  );
});
