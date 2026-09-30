// Coverage for the fifth parameter of Bun.udpSocket's `data` callback
// (`ReceiveFlags.truncated` from MSG_TRUNC) and for Linux's IP_RECVERR
// surfacing ICMP errors as `error` events on the socket.

import { udpSocket } from "bun";
import { describe, expect, test } from "bun:test";
import { isLinux, isWindows } from "harness";

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
          error(_socket, err: Error & { code?: string }) {
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

  // A connected socket gets the ICMP error on Linux and macOS. Linux reads it
  // from the error queue. macOS gets it from the receive that fails.
  test.skipIf(isWindows)("a connected socket reports ECONNREFUSED as error(socket, error) and stays open", async () => {
    // A port that refuses the datagrams of this test and that no other process
    // can bind: a socket connected to another peer holds it.
    const other = await udpSocket({ hostname: "127.0.0.1" });
    const holder = await udpSocket({ hostname: "127.0.0.1", connect: { hostname: "127.0.0.1", port: other.port } });

    const { promise, resolve, reject } = Promise.withResolvers<{ argc: number; socket: unknown; code: unknown }>();
    const sender = await udpSocket({
      connect: { hostname: "127.0.0.1", port: holder.port },
      socket: {
        error(...args: unknown[]) {
          resolve({ argc: args.length, socket: args[0], code: (args[1] as { code?: unknown } | undefined)?.code });
        },
      },
    });

    const send = () => {
      if (sender.closed) return reject(new Error("the socket closed and did not call `error`"));
      // A send can throw the pending ECONNREFUSED before a receive reports it.
      try {
        sender.send("x");
      } catch {}
    };
    const resend = setInterval(send, 10);
    try {
      send();
      const { argc, socket, code } = await promise;
      expect({ argc, socketIsSender: socket === sender, code, closed: sender.closed }).toEqual({
        argc: 2,
        socketIsSender: true,
        code: "ECONNREFUSED",
        closed: false,
      });
    } finally {
      clearInterval(resend);
      sender.close();
      holder.close();
      other.close();
    }
  });
});
