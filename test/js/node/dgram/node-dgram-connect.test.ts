/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * connect() hands the address that the lookup returned to the UDP handle. The
 * handle reads it with libuv's uv_ip4_addr() or uv_ip6_addr(), by the type of
 * the socket, and does not resolve it. uv_ip6_addr() takes a `%zone` that
 * names an interface, and reads a name that no interface has as no zone. A
 * text that is not an address of the socket's family is UV_EINVAL. doConnect()
 * reports what the handle returned as `connect <code> <address>:<port>`, with
 * the address that connect() was called with:
 * https://github.com/nodejs/node/blob/v26.3.0/src/udp_wrap.cc#L287-L300
 * https://github.com/nodejs/node/blob/v26.3.0/src/udp_wrap.cc#L337-L364
 * https://github.com/nodejs/node/blob/v26.3.0/deps/uv/src/uv-common.c#L254-L296
 * https://github.com/nodejs/node/blob/v26.3.0/lib/dgram.js#L459-L484
 */
import assert from "node:assert";
import dgram from "node:dgram";
import { once } from "node:events";
import os from "node:os";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { getSystemErrorName } from "node:util";

type SocketType = "udp4" | "udp6";
type Lookup = NonNullable<dgram.SocketOptions["lookup"]>;

const loopback = { udp4: "127.0.0.1", udp6: "::1" } as const;

// CI hosts can be without IPv6, and every udp6 test needs a socket on ::1.
const hasIPv6Loopback = await new Promise<boolean>(resolve => {
  const probe = dgram.createSocket("udp6");
  probe.once("error", () => resolve(false));
  probe.bind(0, "::1", () => probe.close(() => resolve(true)));
});
// "lo" or "lo0". On Windows uv_ip6_addr() reads a zone as the index of the interface, not as its name.
const loopbackInterface =
  process.platform === "win32"
    ? undefined
    : Object.entries(os.networkInterfaces()).find(([, addresses]) => addresses?.some(a => a.address === "::1"))?.[0];

// Answers "host.invalid" with `answer`. bind() looks its own address up too, and that one stays as it is.
function lookupAnswers(answer: string): Lookup {
  return ((hostname: string, family: number, callback: (err: Error | null, address: string, family: number) => void) =>
    callback(null, hostname === "host.invalid" ? answer : hostname, family)) as unknown as Lookup;
}

async function bound(type: SocketType, options: Partial<dgram.SocketOptions> = {}) {
  const socket = dgram.createSocket({ type, ...options });
  // A lookup that answers at once makes bind() emit 'listening' before it returns.
  const listening = once(socket, "listening");
  socket.bind(0, loopback[type]);
  await listening;
  return socket;
}

// The error that the callback of connect() gets, or null when the socket connects. 'error' must stay silent.
function connect(socket: dgram.Socket, port: number, address: string) {
  return new Promise<NodeJS.ErrnoException | null>((resolve, reject) => {
    socket.once("error", reject);
    socket.connect(port, address, (err?: Error) => {
      socket.removeListener("error", reject);
      resolve(err ?? null);
    });
  });
}

function remoteAddressOrCode(socket: dgram.Socket) {
  try {
    return socket.remoteAddress();
  } catch (err) {
    return (err as NodeJS.ErrnoException).code;
  }
}

function shapeOf(err: (NodeJS.ErrnoException & { address?: string; port?: number }) | null) {
  if (err === null) return null;
  const { name, code, syscall, address, port, message, errno } = err;
  return { name, code, syscall, address, port, message, errno: typeof errno === "number" && getSystemErrorName(errno) };
}

function connectError(code: string, address: string, port: number) {
  return {
    name: "Error",
    code,
    syscall: "connect",
    address,
    port,
    message: `connect ${code} ${address}:${port}`,
    errno: code,
  };
}

// connect() gave no error: the kernel has the peer, and a send() without an address goes to it.
async function assertConnectedTo(socket: dgram.Socket, peer: dgram.Socket, type: SocketType) {
  const port = peer.address().port;
  assert.deepStrictEqual(socket.remoteAddress(), {
    address: loopback[type],
    family: type === "udp6" ? "IPv6" : "IPv4",
    port,
  });
  const received = once(peer, "message");
  const { promise: sent, resolve, reject } = Promise.withResolvers<void>();
  socket.send("to the peer", err => (err ? reject(err) : resolve()));
  const [[message, rinfo]] = await Promise.all([received, sent]);
  assert.deepStrictEqual(
    { message: String(message), from: rinfo.port },
    { message: "to the peer", from: socket.address().port },
  );
}

describe("dgram connect() reads the address as the UDP handle does", () => {
  test(
    "udp6: a zone that names the loopback interface connects to ::1",
    {
      skip: !hasIPv6Loopback || loopbackInterface === undefined,
    },
    async () => {
      const peer = await bound("udp6");
      const socket = await bound("udp6");
      try {
        assert.strictEqual(await connect(socket, peer.address().port, `::1%${loopbackInterface}`), null);
        await assertConnectedTo(socket, peer, "udp6");
      } finally {
        socket.close();
        peer.close();
      }
    },
  );

  test("udp6: a zone that names no interface is no zone", { skip: !hasIPv6Loopback }, async () => {
    const peer = await bound("udp6");
    // Not bound yet: connect() binds the socket first, and connects when that is done.
    const socket = dgram.createSocket("udp6");
    try {
      assert.strictEqual(await connect(socket, peer.address().port, "::1%nosuch0"), null);
      await assertConnectedTo(socket, peer, "udp6");
    } finally {
      socket.close();
      peer.close();
    }
  });

  // dns.lookup() takes "::1%" for a name, so only another lookup gets it to the handle.
  test("udp6: an empty zone is no zone", { skip: !hasIPv6Loopback }, async () => {
    const peer = await bound("udp6");
    const socket = await bound("udp6", { lookup: lookupAnswers("::1%") });
    try {
      assert.strictEqual(await connect(socket, peer.address().port, "host.invalid"), null);
      await assertConnectedTo(socket, peer, "udp6");
    } finally {
      socket.close();
      peer.close();
    }
  });

  // What connect(2) itself says, which the callback gets as it is. Each kernel has its own answers, and these are
  // the ones of Linux. The zone of fe80::1 decides between the first two: no interface, or one with no route.
  const refusedByLinux: [
    name: string,
    type: SocketType,
    options: Partial<dgram.SocketOptions>,
    address: string,
    code: string,
  ][] = [
    ["a link-local address whose zone names no interface", "udp6", {}, "fe80::1%nosuch0", "EINVAL"],
    [
      "a link-local address in the zone of the loopback interface",
      "udp6",
      {},
      `fe80::1%${loopbackInterface}`,
      "ENETUNREACH",
    ],
    ["an IPv4-mapped address from an IPv6-only socket", "udp6", { ipv6Only: true }, "::ffff:127.0.0.1", "ENETUNREACH"],
    ["the broadcast address without SO_BROADCAST", "udp4", {}, "255.255.255.255", "EACCES"],
  ];
  for (const [name, type, options, address, code] of refusedByLinux) {
    test(
      `${type}: ${name} is connect ${code}`,
      {
        skip: process.platform !== "linux" || (type === "udp6" && !hasIPv6Loopback),
      },
      async () => {
        const socket = await bound(type, options);
        try {
          const err = await connect(socket, 4321, address);
          assert.deepStrictEqual(shapeOf(err), connectError(code, address, 4321));
          assert.strictEqual(remoteAddressOrCode(socket), "ERR_SOCKET_DGRAM_NOT_CONNECTED");
        } finally {
          socket.close();
        }
      },
    );
  }

  const otherFamily: [SocketType, string][] = [
    ["udp4", "::1"],
    ["udp6", "127.0.0.1"],
  ];
  for (const [type, address] of otherFamily) {
    test(`${type}: ${address} is connect EINVAL`, { skip: type === "udp6" && !hasIPv6Loopback }, async () => {
      const socket = await bound(type);
      try {
        const err = await connect(socket, 4321, address);
        assert.deepStrictEqual(shapeOf(err), connectError("EINVAL", address, 4321));
        assert.strictEqual(remoteAddressOrCode(socket), "ERR_SOCKET_DGRAM_NOT_CONNECTED");
      } finally {
        socket.close();
      }
    });
  }

  // The handle does not resolve a name and does not take what inet_aton() takes. The error has the address that
  // connect() was called with, not the text that the lookup returned.
  for (const answer of ["not-an-ip", "localhost", "127.1"]) {
    test(`udp4: a lookup that returns ${JSON.stringify(answer)} is connect EINVAL`, async () => {
      const socket = await bound("udp4", { lookup: lookupAnswers(answer) });
      try {
        const err = await connect(socket, 4321, "host.invalid");
        assert.deepStrictEqual(shapeOf(err), connectError("EINVAL", "host.invalid", 4321));
        assert.deepStrictEqual(
          { remoteAddress: remoteAddressOrCode(socket), connectListeners: socket.listenerCount("connect") },
          { remoteAddress: "ERR_SOCKET_DGRAM_NOT_CONNECTED", connectListeners: 0 },
        );
      } finally {
        socket.close();
      }
    });
  }

  test("without a callback the error is emitted as 'error'", async () => {
    const socket = await bound("udp4");
    try {
      const { promise: emitted, resolve, reject } = Promise.withResolvers<NodeJS.ErrnoException>();
      socket.once("error", resolve);
      socket.once("connect", () => reject(new Error("'connect' was emitted")));
      socket.connect(4321, "::1");
      assert.deepStrictEqual(shapeOf(await emitted), connectError("EINVAL", "::1", 4321));
    } finally {
      socket.close();
    }
  });

  test("a connect() that failed leaves the socket free to connect", async () => {
    const peer = await bound("udp4");
    const socket = await bound("udp4");
    try {
      const port = peer.address().port;
      assert.deepStrictEqual(shapeOf(await connect(socket, port, "::1")), connectError("EINVAL", "::1", port));
      assert.strictEqual(await connect(socket, port, "127.0.0.1"), null);
      await assertConnectedTo(socket, peer, "udp4");
    } finally {
      socket.close();
      peer.close();
    }
  });

  // The handle is an IPv4 or an IPv6 one from the start. `socket.type` is a plain property that nothing reads again.
  test("udp4: the family is the one of createSocket(), not of socket.type", async () => {
    const peer = await bound("udp4");
    const socket = await bound("udp4");
    try {
      (socket as dgram.Socket & { type: string }).type = "udp6";
      assert.strictEqual(await connect(socket, peer.address().port, "127.0.0.1"), null);
      await assertConnectedTo(socket, peer, "udp4");
    } finally {
      socket.close();
      peer.close();
    }
  });

  // doConnect() runs once for each answer of the lookup. The handle is connected by the first one and refuses the
  // second, and that error is the last word: dgram takes the socket for not connected.
  test("a lookup that answers twice: the second connect is EISCONN", async () => {
    const peer = await bound("udp4");
    const twice = ((
      hostname: string,
      family: number,
      callback: (err: null, address: string, family: number) => void,
    ) => {
      callback(null, hostname === "host.invalid" ? "127.0.0.1" : hostname, family);
      if (hostname === "host.invalid") callback(null, "127.0.0.1", family);
    }) as unknown as Lookup;
    const socket = await bound("udp4", { lookup: twice });
    try {
      const port = peer.address().port;
      const calls: ReturnType<typeof shapeOf>[] = [];
      const { promise: calledTwice, resolve, reject } = Promise.withResolvers<void>();
      socket.once("error", reject);
      socket.connect(port, "host.invalid", (err?: Error) => {
        calls.push(shapeOf(err ?? null));
        if (calls.length === 2) resolve();
      });
      await calledTwice;
      assert.deepStrictEqual(calls, [null, connectError("EISCONN", "host.invalid", port)]);
      assert.strictEqual(remoteAddressOrCode(socket), "ERR_SOCKET_DGRAM_NOT_CONNECTED");
    } finally {
      socket.close();
      peer.close();
    }
  });

  test("udp6: connect(), disconnect(), connect() to an address with a zone", { skip: !hasIPv6Loopback }, async () => {
    const peer = await bound("udp6");
    const socket = await bound("udp6");
    try {
      const port = peer.address().port;
      assert.strictEqual(await connect(socket, port, "::1"), null);
      socket.disconnect();
      assert.strictEqual(remoteAddressOrCode(socket), "ERR_SOCKET_DGRAM_NOT_CONNECTED");
      assert.strictEqual(await connect(socket, port, "::1%nosuch0"), null);
      await assertConnectedTo(socket, peer, "udp6");
    } finally {
      socket.close();
      peer.close();
    }
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExeAtLeast } = await import("harness");
  // The expected values above are those of v26.3.0.
  const node = nodeExeAtLeast("26.3.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, fileURLToPath(import.meta.url)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
