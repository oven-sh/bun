// Coverage for the fifth parameter of Bun.udpSocket's `data` callback
// (`ReceiveFlags.truncated` from MSG_TRUNC) and for which ICMP errors reach
// the `error` handler of the socket.

import { udpSocket } from "bun";
import { describe, expect, test } from "bun:test";
import { isLinux, isWindows } from "harness";
import { replyServerAfterVanishedClient } from "./reply-server";

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
});

// Linux drops the ICMP error of a datagram from an unconnected socket, unless
// the socket has IP_RECVERR. With that option the `error` handler can report
// a closed port (#28827), but the kernel also records the error on the
// socket: the next send fails with it, whichever peer that one is for, and so
// does the next recv, so a reply server ends with the first client that
// closes its port. Like libuv and Node, Bun does not set it: only a connected
// socket gets the ICMP error of its one peer.
describe("udpSocket() and ICMP errors", () => {
  async function closedPort() {
    const probe = await udpSocket({ hostname: "127.0.0.1" });
    const port = probe.port;
    probe.close();
    return port;
  }

  // Two echoes between two new sockets take four loop iterations: every poll
  // event that was ready before the call has been handled by the end.
  async function echoRoundTrips() {
    const { promise, resolve } = Promise.withResolvers<void>();
    const echo = await udpSocket({
      hostname: "127.0.0.1",
      socket: {
        data(socket, data, port, address) {
          socket.send(data, port, address);
        },
      },
    });
    let echoes = 0;
    const client = await udpSocket({
      hostname: "127.0.0.1",
      socket: {
        data(socket) {
          if (++echoes === 2) resolve();
          else socket.send("x", echo.port, "127.0.0.1");
        },
      },
    });
    try {
      client.send("x", echo.port, "127.0.0.1");
      await promise;
    } finally {
      client.close();
      echo.close();
    }
  }

  // The handler gets (error) today and (socket, error) by its types (#44274).
  const lastArgument = (args: unknown[]) => args.at(-1) as Error & { code?: string; syscall?: string };

  test("an unconnected socket: a datagram to a closed port fails neither the next send nor the socket", async () => {
    const deadPort = await closedPort();
    const errors: unknown[] = [];
    const { promise: delivered, resolve: onData } = Promise.withResolvers<string>();
    const receiver = await udpSocket({
      hostname: "127.0.0.1",
      socket: { data: (_socket, data) => onData(data.toString()) },
    });
    const sender = await udpSocket({
      hostname: "127.0.0.1",
      socket: { error: (...args: unknown[]) => void errors.push(lastArgument(args)) },
    });
    try {
      // One tick: over loopback the ICMP error of "dead" is back before "alive" goes out.
      sender.send("dead", deadPort, "127.0.0.1");
      sender.send("alive", receiver.port, "127.0.0.1");
      expect(await delivered).toBe("alive");
      await echoRoundTrips();
      expect({ errors, closed: sender.closed }).toEqual({ errors: [], closed: false });
    } finally {
      sender.close();
      receiver.close();
    }
  });

  // Windows turns these reports off at the socket (SIO_UDP_CONNRESET).
  test.skipIf(isWindows)("a connected socket gets ECONNREFUSED for its closed peer and stays open", async () => {
    const deadPort = await closedPort();
    const { promise: errored, resolve: onError } = Promise.withResolvers<Error & { code?: string; syscall?: string }>();
    const sender = await udpSocket({
      connect: { hostname: "127.0.0.1", port: deadPort },
      socket: { error: (...args: unknown[]) => onError(lastArgument(args)) },
    });
    try {
      // Keep sending until the error arrives: a send can take the pending
      // error before the receive path does, and then throws it.
      let stop = false;
      const pump = (async () => {
        for (let i = 0; i < 100 && !stop; i++) {
          if (sender.closed) return onError(new Error("the socket was closed instead of reporting the error"));
          try {
            sender.send("dead");
          } catch {}
          await echoRoundTrips();
        }
      })();
      const err = await errored;
      stop = true;
      await pump;
      expect({ code: err.code, syscall: err.syscall, errqueue: "errqueue" in err, closed: sender.closed }).toEqual({
        code: "ECONNREFUSED",
        syscall: "recv",
        errqueue: false,
        closed: false,
      });
    } finally {
      sender.close();
    }
  });

  // A socket with IP_RECVERR also gets a queued report for a send that failed
  // locally: the handler would get the error that send() already threw.
  test.skipIf(!isLinux).each(["unconnected", "connected"])(
    "an oversized send throws EMSGSIZE and reports nothing more (%s socket)",
    async kind => {
      const errors: unknown[] = [];
      const socket = { error: (...args: unknown[]) => void errors.push(lastArgument(args).code) };
      const peer = await udpSocket({ hostname: "127.0.0.1" });
      const sender: any =
        kind === "connected"
          ? await udpSocket({ connect: { hostname: "127.0.0.1", port: peer.port }, socket })
          : await udpSocket({ hostname: "127.0.0.1", socket });
      try {
        const oversized = new Uint8Array(65510);
        let thrown: any;
        try {
          if (kind === "connected") sender.send(oversized);
          else sender.send(oversized, peer.port, "127.0.0.1");
        } catch (err) {
          thrown = err;
        }
        await echoRoundTrips();
        expect({ thrown: thrown?.code, errors }).toEqual({ thrown: "EMSGSIZE", errors: [] });
      } finally {
        sender.close();
        peer.close();
      }
    },
  );

  test("a reply server with only a data handler outlives a client that closed its port", async () => {
    expect(await replyServerAfterVanishedClient("udpSocket")).toEqual({
      answeredVanished: true,
      received: ["ping"],
      exitedEarly: false,
      stderr: "",
      exitCode: 0,
    });
  });
});
