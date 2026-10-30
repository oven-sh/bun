/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * send() hands the address that the lookup returned to the UDP handle. The
 * handle reads it with libuv's uv_ip4_addr() or uv_ip6_addr(), by the type of
 * the socket. It resolves no name and takes no inet_aton() shorthand, so
 * "127.1" is not 127.0.0.1. A text that is not an address of the socket's
 * family is UV_EINVAL, and no datagram leaves. doSend() reports what the
 * handle returned as `send <code> <address>:<port>`, with the address that
 * send() was called with. It asks `sendBlockList` before it asks the handle:
 * https://github.com/nodejs/node/blob/v26.3.0/src/udp_wrap.cc#L287-L300
 * https://github.com/nodejs/node/blob/v26.3.0/src/udp_wrap.cc#L533-L602
 * https://github.com/nodejs/node/blob/v26.3.0/deps/uv/src/uv-common.c#L254-L296
 * https://github.com/nodejs/node/blob/v26.3.0/lib/dgram.js#L716-L766
 */
import assert from "node:assert";
import dgram from "node:dgram";
import { once } from "node:events";
import net from "node:net";
import os from "node:os";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { getSystemErrorName } from "node:util";

type SocketType = "udp4" | "udp6";
type Lookup = NonNullable<dgram.SocketOptions["lookup"]>;
type LookupCallback = (err: Error | null, address: string, family: number) => void;
type SendError = NodeJS.ErrnoException & { address?: string; port?: number };
// sendto() is the undocumented form of send() with an offset and a length.
type SendTo = (
  buffer: Buffer,
  offset: number,
  length: number,
  port: number,
  address: string,
  callback: (err: SendError | null) => void,
) => void;

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
  return ((hostname: string, family: number, callback: LookupCallback) =>
    callback(null, hostname === "host.invalid" ? answer : hostname, family)) as unknown as Lookup;
}

function blockList(address: string) {
  const list = new net.BlockList();
  list.addAddress(address, net.isIPv6(address) ? "ipv6" : "ipv4");
  return list;
}

// Bound to the address of every interface. On Linux a udp6 socket on "::" is the one that the kernel lets send to IPv4.
async function bound(type: SocketType, options: Partial<dgram.SocketOptions> = {}) {
  const socket = dgram.createSocket({ type, ...options });
  // A lookup that answers at once makes bind() emit 'listening' before it returns.
  const listening = once(socket, "listening");
  socket.bind(0);
  await listening;
  return socket;
}

// A socket on the loopback address of `type`, and every datagram that it got.
async function receiver(type: SocketType) {
  const socket = dgram.createSocket(type);
  const listening = once(socket, "listening");
  socket.bind(0, loopback[type]);
  await listening;
  const received: string[] = [];
  socket.on("message", message => received.push(String(message)));
  return { socket, received, type, port: socket.address().port };
}
type Receiver = Awaited<ReturnType<typeof receiver>>;

// What `to` got up to now. The loopback interface keeps the order, so a datagram that an earlier send() gave to the
// kernel is in front of the one that this sends. No timer decides that nothing else is on its way.
async function receivedBy(to: Receiver) {
  const last = dgram.createSocket(to.type);
  try {
    const { promise: arrived, resolve, reject } = Promise.withResolvers<void>();
    const onMessage = (message: Buffer) => {
      if (String(message) === "last") resolve();
    };
    to.socket.on("message", onMessage);
    last.once("error", reject);
    last.send("last", to.port, loopback[to.type], err => err && reject(err));
    await arrived;
    to.socket.removeListener("message", onMessage);
    return to.received.splice(0).filter(message => message !== "last");
  } finally {
    last.close();
  }
}

// The error that the callback of send() gets, or null when the handle took the datagram. 'error' must stay silent.
function send(socket: dgram.Socket, message: string | Uint8Array | Uint8Array[], port: number, address?: string) {
  return new Promise<SendError | null>((resolve, reject) => {
    socket.once("error", reject);
    const callback = (err: SendError | null) => {
      socket.removeListener("error", reject);
      resolve(err);
    };
    if (address === undefined) socket.send(message, port, callback);
    else socket.send(message, port, address, callback);
  });
}

function shapeOf(err: SendError | null) {
  if (err === null) return null;
  const { name, code, syscall, address, port, message, errno } = err;
  return { name, code, syscall, address, port, message, errno: typeof errno === "number" && getSystemErrorName(errno) };
}

function sendError(code: string, address: string, port: number) {
  return {
    name: "Error",
    code,
    syscall: "send",
    address,
    port,
    message: `send ${code} ${address}:${port}`,
    errno: code,
  };
}

function blocked(ip: string) {
  return {
    name: "Error",
    code: "ERR_IP_BLOCKED",
    syscall: undefined,
    address: undefined,
    port: undefined,
    message: `IP(${ip}) is blocked by net.BlockList`,
    errno: false,
  };
}

// The handle refused the answer of the lookup: the callback gets `send EINVAL` with the address that send() was
// called with, and `to` gets nothing.
async function assertRefused(socket: dgram.Socket, to: Receiver) {
  const err = await send(socket, "to no address", to.port, "host.invalid");
  assert.deepStrictEqual(
    { error: shapeOf(err), received: await receivedBy(to) },
    { error: sendError("EINVAL", "host.invalid", to.port), received: [] },
  );
}

describe("dgram send() reads the address as the UDP handle does", () => {
  // What inet_aton() and getaddrinfo() read as 127.0.0.1 or as 0.0.0.0, which is this host too. The handle reads
  // none of them, and it resolves no name.
  const notAnAddress = [
    "127.1",
    "2130706433",
    "0x7f000001",
    "0177.0.0.1",
    "127.000.000.001",
    "0x7f.0.0.1",
    "127.0.0.01",
    "0",
    "localhost",
    "not-an-ip",
    "127.0.0.1 x",
    "127.0.0.1/32",
    "",
  ];
  for (const answer of notAnAddress) {
    test(`udp4: a lookup that returns ${JSON.stringify(answer)} is send EINVAL`, async () => {
      const to = await receiver("udp4");
      const socket = await bound("udp4", { lookup: lookupAnswers(answer) });
      try {
        await assertRefused(socket, to);
      } finally {
        socket.close();
        to.socket.close();
      }
    });
  }

  // The list does not know these texts, so it does not block them. A handle that read them as inet_aton() does
  // would send to the address that the list blocks.
  for (const answer of ["127.1", "2130706433", "0177.0.0.1", "0x7f.0.0.1"]) {
    test(`udp4: sendBlockList holds when a lookup returns ${JSON.stringify(answer)}`, async () => {
      const to = await receiver("udp4");
      const socket = await bound("udp4", { lookup: lookupAnswers(answer), sendBlockList: blockList("127.0.0.1") });
      try {
        await assertRefused(socket, to);
      } finally {
        socket.close();
        to.socket.close();
      }
    });
  }

  test("udp6: sendBlockList holds when a lookup returns shorthand", { skip: !hasIPv6Loopback }, async () => {
    const to = await receiver("udp4");
    const socket = await bound("udp6", { lookup: lookupAnswers("127.1"), sendBlockList: blockList("127.0.0.1") });
    try {
      await assertRefused(socket, to);
    } finally {
      socket.close();
      to.socket.close();
    }
  });

  // A socket of one family takes no address of the other one. The Linux kernel would: an IPv6 socket that is not
  // IPv6-only sends to an IPv4 address.
  const otherFamily: [SocketType, string][] = [
    ["udp4", "::1"],
    ["udp6", "127.0.0.1"],
  ];
  for (const [type, address] of otherFamily) {
    test(`${type}: ${address} is send EINVAL`, { skip: !hasIPv6Loopback }, async () => {
      const to = await receiver(type === "udp4" ? "udp6" : "udp4");
      const socket = await bound(type);
      try {
        const err = await send(socket, "to the other family", to.port, address);
        assert.deepStrictEqual(
          { error: shapeOf(err), received: await receivedBy(to) },
          { error: sendError("EINVAL", address, to.port), received: [] },
        );
      } finally {
        socket.close();
        to.socket.close();
      }
    });
  }

  // dgram asks the list before it asks the handle, so an address of the other family that the list blocks is
  // ERR_IP_BLOCKED and not EINVAL.
  test("udp6: sendBlockList blocks 127.0.0.1 before the handle refuses it", { skip: !hasIPv6Loopback }, async () => {
    const to = await receiver("udp4");
    const socket = await bound("udp6", { sendBlockList: blockList("127.0.0.1") });
    try {
      const errors = [
        shapeOf(await send(socket, "blocked", to.port, "127.0.0.1")),
        shapeOf(await send(socket, "blocked", to.port, "::ffff:127.0.0.1")),
      ];
      assert.deepStrictEqual(
        { errors, received: await receivedBy(to) },
        { errors: [blocked("127.0.0.1"), blocked("::ffff:127.0.0.1")], received: [] },
      );
    } finally {
      socket.close();
      to.socket.close();
    }
  });

  test("udp4: sendBlockList blocks the address that the lookup returns", async () => {
    const to = await receiver("udp4");
    const socket = await bound("udp4", { lookup: lookupAnswers("127.0.0.1"), sendBlockList: blockList("127.0.0.1") });
    try {
      const err = await send(socket, "blocked", to.port, "host.invalid");
      assert.deepStrictEqual(
        { error: shapeOf(err), received: await receivedBy(to) },
        { error: blocked("127.0.0.1"), received: [] },
      );
    } finally {
      socket.close();
      to.socket.close();
    }
  });

  // The handle reads a zone and the list reads the address in front of it.
  test(
    "udp6: sendBlockList blocks ::1 with a zone",
    { skip: !hasIPv6Loopback || loopbackInterface === undefined },
    async () => {
      const to = await receiver("udp6");
      const socket = await bound("udp6", { sendBlockList: blockList("::1") });
      try {
        const address = `::1%${loopbackInterface}`;
        const err = await send(socket, "blocked", to.port, address);
        assert.deepStrictEqual(
          { error: shapeOf(err), received: await receivedBy(to) },
          { error: blocked(address), received: [] },
        );
      } finally {
        socket.close();
        to.socket.close();
      }
    },
  );

  // Without a callback nobody hears of it: doSend() reports what the handle returned to the callback only.
  test("without a callback the datagram is dropped and no 'error' is emitted", async () => {
    const to = await receiver("udp4");
    const socket = await bound("udp4", { lookup: lookupAnswers("127.1") });
    try {
      const errors: Error[] = [];
      socket.on("error", err => errors.push(err));
      socket.send("to no address", to.port, "host.invalid");
      assert.deepStrictEqual({ received: await receivedBy(to), errors }, { received: [], errors: [] });
    } finally {
      socket.close();
      to.socket.close();
    }
  });

  // The send() that binds the socket waits for 'listening', and the handle reads the address after that.
  test("udp4: a send() on a socket that is not bound yet is send EINVAL too", async () => {
    const to = await receiver("udp4");
    const socket = dgram.createSocket({ type: "udp4", lookup: lookupAnswers("127.1") });
    try {
      await assertRefused(socket, to);
    } finally {
      socket.close();
      to.socket.close();
    }
  });

  test("udp4: sendto() and a list of buffers are send EINVAL too", async () => {
    const to = await receiver("udp4");
    const socket = await bound("udp4", { lookup: lookupAnswers("127.1") });
    try {
      const { promise: sentTo, resolve, reject } = Promise.withResolvers<SendError | null>();
      socket.once("error", reject);
      (socket as dgram.Socket & { sendto: SendTo }).sendto(
        Buffer.from("to no address"),
        0,
        13,
        to.port,
        "host.invalid",
        resolve,
      );
      const errors = [
        shapeOf(await sentTo),
        shapeOf(await send(socket, [Buffer.from("to no "), Buffer.from("address")], to.port, "host.invalid")),
      ];
      const refused = sendError("EINVAL", "host.invalid", to.port);
      assert.deepStrictEqual({ errors, received: await receivedBy(to) }, { errors: [refused, refused], received: [] });
    } finally {
      socket.close();
      to.socket.close();
    }
  });

  test("a send() that failed leaves the socket free to send", async () => {
    const to = await receiver("udp4");
    const socket = await bound("udp4");
    try {
      assert.deepStrictEqual(
        shapeOf(await send(socket, "refused", to.port, "::1")),
        sendError("EINVAL", "::1", to.port),
      );
      assert.strictEqual(await send(socket, "taken", to.port, "127.0.0.1"), null);
      assert.deepStrictEqual(await receivedBy(to), ["taken"]);
    } finally {
      socket.close();
      to.socket.close();
    }
  });

  // The handle is an IPv4 or an IPv6 one from the start. `socket.type` is a plain property that nothing reads again.
  test("udp4: the family is the one of createSocket(), not of socket.type", async () => {
    const to = await receiver("udp4");
    const socket = await bound("udp4");
    try {
      (socket as dgram.Socket & { type: string }).type = "udp6";
      assert.strictEqual(await send(socket, "taken", to.port, "127.0.0.1"), null);
      assert.deepStrictEqual(await receivedBy(to), ["taken"]);
    } finally {
      socket.close();
      to.socket.close();
    }
  });

  // What the handle does take: the address of its family as inet_pton() reads it, and for IPv6 a zone after it.
  const taken: [name: string, type: SocketType, address: string, to: SocketType, skip?: boolean][] = [
    ["an IPv4 address", "udp4", "127.0.0.1", "udp4"],
    ["an IPv6 address written in full", "udp6", "0:0:0:0:0:0:0:1", "udp6"],
    ["::1 in the zone of the loopback interface", "udp6", `::1%${loopbackInterface}`, "udp6", !loopbackInterface],
    ["::1 in a zone that names no interface", "udp6", "::1%nosuch0", "udp6"],
    ["an IPv4-mapped address, which is the IPv4 address", "udp6", "::ffff:127.0.0.1", "udp4"],
  ];
  for (const [name, type, address, toType, skip = false] of taken) {
    test(`${type}: the handle takes ${name}`, { skip: skip || (type === "udp6" && !hasIPv6Loopback) }, async () => {
      const to = await receiver(toType);
      const socket = await bound(type, { lookup: lookupAnswers(address), sendBlockList: blockList("192.0.2.1") });
      try {
        assert.strictEqual(await send(socket, "taken", to.port, "host.invalid"), null);
        assert.deepStrictEqual(await receivedBy(to), ["taken"]);
      } finally {
        socket.close();
        to.socket.close();
      }
    });
  }

  for (const type of ["udp4", "udp6"] as const) {
    const skip = type === "udp6" && !hasIPv6Loopback;
    test(`${type}: a send() without an address goes to the loopback address`, { skip }, async () => {
      const to = await receiver(type);
      const socket = await bound(type);
      try {
        assert.strictEqual(await send(socket, [Buffer.from("a list "), Buffer.from("of buffers")], to.port), null);
        assert.deepStrictEqual(await receivedBy(to), ["a list of buffers"]);
      } finally {
        socket.close();
        to.socket.close();
      }
    });
  }

  // A udp6 socket on "::" hears an IPv4 peer as an IPv4-mapped address. That is an address of its family, so the
  // answer to `rinfo.address` arrives, where an answer to "127.0.0.1" is send EINVAL.
  test("udp6: a socket on :: answers an IPv4 peer at rinfo.address", { skip: !hasIPv6Loopback }, async () => {
    const to = await receiver("udp4");
    const socket = await bound("udp6");
    try {
      const asked = once(socket, "message");
      assert.strictEqual(await send(to.socket, "ping", socket.address().port, "127.0.0.1"), null);
      const [, rinfo] = await asked;
      assert.deepStrictEqual(
        { address: rinfo.address, family: rinfo.family, port: rinfo.port },
        { address: "::ffff:127.0.0.1", family: "IPv6", port: to.port },
      );
      assert.strictEqual(await send(socket, "pong", rinfo.port, rinfo.address), null);
      assert.deepStrictEqual(await receivedBy(to), ["pong"]);
    } finally {
      socket.close();
      to.socket.close();
    }
  });

  // The handle hands the zone to the kernel. On Linux the loopback interface has no route to a link-local address.
  test(
    "udp6: a link-local address in the zone of the loopback interface is send ENETUNREACH",
    { skip: process.platform !== "linux" || !hasIPv6Loopback || loopbackInterface === undefined },
    async () => {
      const socket = await bound("udp6");
      try {
        const address = `fe80::1%${loopbackInterface}`;
        assert.deepStrictEqual(
          shapeOf(await send(socket, "to no route", 4321, address)),
          sendError("ENETUNREACH", address, 4321),
        );
      } finally {
        socket.close();
      }
    },
  );

  // What the kernel says about a datagram goes to the callback in the same form.
  test("udp4: a datagram that is too long is send EMSGSIZE", async () => {
    const to = await receiver("udp4");
    const socket = await bound("udp4");
    try {
      const err = await send(socket, Buffer.alloc(70_000), to.port, "127.0.0.1");
      assert.deepStrictEqual(
        { error: shapeOf(err), received: await receivedBy(to) },
        { error: sendError("EMSGSIZE", "127.0.0.1", to.port), received: [] },
      );
    } finally {
      socket.close();
      to.socket.close();
    }
  });

  test("udp4: a connected socket sends with no address", async () => {
    const to = await receiver("udp4");
    const socket = await bound("udp4", { lookup: lookupAnswers("127.1") });
    try {
      const connected = once(socket, "connect");
      socket.connect(to.port, "127.0.0.1");
      await connected;
      const { promise: sent, resolve, reject } = Promise.withResolvers<void>();
      socket.send("to the peer", err => (err ? reject(err) : resolve()));
      await sent;
      assert.deepStrictEqual(await receivedBy(to), ["to the peer"]);
    } finally {
      socket.close();
      to.socket.close();
    }
  });

  // send() looked the address up while the socket had no peer. When the answer comes the socket has one, and a
  // connected handle takes no address. The handle reads the address first: what is no address is EINVAL there too.
  const lateAnswers: [answer: string, code: string][] = [
    ["127.0.0.1", "EISCONN"],
    ["127.1", "EINVAL"],
  ];
  for (const [late, code] of lateAnswers) {
    test(`udp4: an answer of ${late} that reaches the handle after connect() is send ${code}`, async () => {
      const to = await receiver("udp4");
      const { promise: asked, resolve: onAsked } = Promise.withResolvers<LookupCallback>();
      const lookup = ((hostname: string, family: number, callback: LookupCallback) => {
        if (hostname === "late.invalid") onAsked(callback);
        else callback(null, hostname, family);
      }) as unknown as Lookup;
      const socket = await bound("udp4", { lookup });
      try {
        const { promise: sent, resolve, reject } = Promise.withResolvers<SendError | null>();
        socket.once("error", reject);
        socket.send("to an address", to.port, "late.invalid", resolve);
        const answer = await asked;
        const connected = once(socket, "connect");
        socket.connect(to.port, "127.0.0.1");
        await connected;
        answer(null, late, 4);
        assert.deepStrictEqual(
          { error: shapeOf(await sent), received: await receivedBy(to) },
          { error: sendError(code, "late.invalid", to.port), received: [] },
        );
      } finally {
        socket.close();
        to.socket.close();
      }
    });
  }
});

// Each runtime is held to its own answer, so a row fails when either one changes.
describe("dgram send() where Bun does not answer as Node.js does", () => {
  const runtime = typeof Bun !== "undefined" ? "bun" : "node";
  type Answer = "sent" | "EINVAL" | "ERR_IP_BLOCKED";
  const rows: [type: SocketType, listed: boolean, answer: string, node: Answer, bun: Answer][] = [
    // Node.js reads a C string. It sends to the text in front of a NUL, which the list did not know as that address.
    ["udp4", false, "127.0.0.1\0rebound.example", "sent", "EINVAL"],
    ["udp4", true, "127.0.0.1\0rebound.example", "sent", "ERR_IP_BLOCKED"],
    ["udp6", false, "::1\0rebound.example", "sent", "EINVAL"],
    // The list of Bun reads these as 127.0.0.1, and the list of Node.js does not. Neither handle takes them.
    ["udp4", true, "0x7f000001", "EINVAL", "ERR_IP_BLOCKED"],
    ["udp4", true, "127.000.000.001", "EINVAL", "ERR_IP_BLOCKED"],
    ["udp4", true, "127.0.0.01", "EINVAL", "ERR_IP_BLOCKED"],
  ];
  for (const [type, listed, answer, node, bun] of rows) {
    const name = `${type}: a lookup that returns ${JSON.stringify(answer)}${listed ? ", which sendBlockList blocks" : ""}`;
    test(name, { skip: type === "udp6" && !hasIPv6Loopback }, async () => {
      const to = await receiver(type);
      const sendBlockList = listed ? blockList(loopback[type]) : undefined;
      const socket = await bound(type, { lookup: lookupAnswers(answer), sendBlockList });
      try {
        const err = await send(socket, "to the loopback address", to.port, "host.invalid");
        const expected = { node, bun }[runtime];
        assert.deepStrictEqual(
          { answer: err === null ? "sent" : err.code, received: await receivedBy(to) },
          { answer: expected, received: expected === "sent" ? ["to the loopback address"] : [] },
        );
      } finally {
        socket.close();
        to.socket.close();
      }
    });
  }
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExeAtLeast } = await import("harness");
  // The expected values above are those of v26.3.0 and of v26.12.1.
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
