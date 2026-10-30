/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * bind() hands the address that the lookup returned to the UDP handle, as
 * connect() and send() do. The handle reads it with libuv's uv_ip4_addr() or
 * uv_ip6_addr(), by the type of the socket, and resolves nothing. A text that
 * is not an address of the socket's family is UV_EINVAL, and bind() emits it
 * as `bind EINVAL <ip>` with the text that the lookup returned. So no socket
 * is bound in the other family than the one that its handle reads addresses
 * of:
 * https://github.com/nodejs/node/blob/v26.3.0/src/udp_wrap.cc#L287-L333
 * https://github.com/nodejs/node/blob/v26.3.0/deps/uv/src/uv-common.c#L254-L296
 * https://github.com/nodejs/node/blob/v26.3.0/lib/dgram.js#L341-L407
 */
import assert from "node:assert";
import dgram from "node:dgram";
import { once } from "node:events";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { getSystemErrorName } from "node:util";

type SocketType = "udp4" | "udp6";
type Lookup = NonNullable<dgram.SocketOptions["lookup"]>;
type LookupCallback = (err: Error | null, address: string, family: number) => void;
type BindError = NodeJS.ErrnoException & { address?: string; port?: number };

// CI hosts can be without IPv6, and a udp6 socket that binds needs ::1.
const hasIPv6Loopback = await new Promise<boolean>(resolve => {
  const probe = dgram.createSocket("udp6");
  probe.once("error", () => resolve(false));
  probe.bind(0, "::1", () => probe.close(() => resolve(true)));
});

// Answers `name` with `answer`, and every other name with itself.
function lookupAnswers(name: string, answer: string): Lookup {
  return ((hostname: string, family: number, callback: LookupCallback) =>
    callback(null, hostname === name ? answer : hostname, family)) as unknown as Lookup;
}

// What bind() comes to: the address that the socket has, or the error that it emits.
function bind(socket: dgram.Socket, port: number, address?: string) {
  return new Promise<{ address: string; family: string } | ReturnType<typeof shapeOf>>(resolve => {
    socket.once("error", err => resolve(shapeOf(err)));
    socket.once("listening", () => {
      const { address, family } = socket.address();
      resolve({ address, family });
    });
    if (address === undefined) socket.bind(port);
    else socket.bind(port, address);
  });
}

function shapeOf(err: BindError) {
  const { name, code, syscall, address, port, message, errno } = err;
  return { name, code, syscall, address, port, message, errno: typeof errno === "number" && getSystemErrorName(errno) };
}

// Node.js gives the error a port only when bind() was called with one that is not 0.
function bindError(address: string, port?: number) {
  return {
    name: "Error",
    code: "EINVAL",
    syscall: "bind",
    address,
    port,
    message: ["bind EINVAL", port ? `${address}:${port}` : address].filter(Boolean).join(" "),
    errno: "EINVAL",
  };
}

describe("dgram bind() reads the address as the UDP handle does", () => {
  // A socket that took one of these would hear its peers and answer none: send() reads an address by the family
  // of the handle, and the kernel takes one of the family of the socket.
  const otherFamily: [SocketType, string][] = [
    ["udp6", "127.0.0.1"],
    ["udp6", "0.0.0.0"],
    ["udp4", "::1"],
    ["udp4", "::"],
  ];
  for (const [type, address] of otherFamily) {
    test(`${type}: ${address} is bind EINVAL`, async () => {
      const socket = dgram.createSocket(type);
      try {
        assert.deepStrictEqual(await bind(socket, 0, address), bindError(address));
      } finally {
        socket.close();
      }
    });
  }

  // Nothing is bound, so the port is only a part of the error.
  test("udp4: the error has the port that bind() was called with", async () => {
    const socket = dgram.createSocket("udp4");
    try {
      assert.deepStrictEqual(await bind(socket, 4321, "::1"), bindError("::1", 4321));
    } finally {
      socket.close();
    }
  });

  // The handle does not resolve a name and does not take what inet_aton() takes. The error has the text that the
  // lookup returned.
  for (const answer of ["localhost", "not-an-ip", "127.1", "2130706433", "0x7f000001", "127.0.0.1/8", ""]) {
    test(`udp4: a lookup that returns ${JSON.stringify(answer)} is bind EINVAL`, async () => {
      const socket = dgram.createSocket({ type: "udp4", lookup: lookupAnswers("host.invalid", answer) });
      try {
        assert.deepStrictEqual(await bind(socket, 0, "host.invalid"), bindError(answer));
      } finally {
        socket.close();
      }
    });
  }

  // The handle converts the answer to a string. No number is an address.
  test("udp4: a lookup that returns the number 2130706433 is bind EINVAL", async () => {
    const lookup = lookupAnswers("host.invalid", 2130706433 as unknown as string);
    const socket = dgram.createSocket({ type: "udp4", lookup });
    try {
      assert.deepStrictEqual(await bind(socket, 0, "host.invalid"), bindError(2130706433 as unknown as string));
    } finally {
      socket.close();
    }
  });

  // send() binds a socket that is not bound to "0.0.0.0", and looks that address up too.
  test("udp4: the bind that send() starts fails in the same way", async () => {
    const socket = dgram.createSocket({ type: "udp4", lookup: lookupAnswers("0.0.0.0", "127.1") });
    try {
      const failed = once(socket, "error");
      socket.send("to a socket that is not bound", 4321, "127.0.0.1");
      const [err] = await failed;
      assert.deepStrictEqual(shapeOf(err), bindError("127.1"));
    } finally {
      socket.close();
    }
  });

  // bind() takes the address of every interface from `socket.type`. The handle is an IPv4 one from the start.
  test("udp4: the family is the one of createSocket(), not of socket.type", async () => {
    const socket = dgram.createSocket("udp4");
    try {
      (socket as dgram.Socket & { type: string }).type = "udp6";
      assert.deepStrictEqual(await bind(socket, 0), bindError("::"));
    } finally {
      socket.close();
    }
  });

  test("udp6: a bind() that failed leaves the socket free to bind", { skip: !hasIPv6Loopback }, async () => {
    const socket = dgram.createSocket("udp6");
    try {
      assert.deepStrictEqual(await bind(socket, 0, "127.0.0.1"), bindError("127.0.0.1"));
      assert.deepStrictEqual(await bind(socket, 0, "::1"), { address: "::1", family: "IPv6" });
    } finally {
      socket.close();
    }
  });

  const taken: [SocketType, string, string][] = [
    ["udp4", "127.0.0.1", "IPv4"],
    ["udp4", "0.0.0.0", "IPv4"],
    ["udp6", "::1", "IPv6"],
    ["udp6", "::", "IPv6"],
    ["udp6", "0:0:0:0:0:0:0:1", "IPv6"],
  ];
  for (const [type, address, family] of taken) {
    test(`${type}: the handle binds ${address}`, { skip: type === "udp6" && !hasIPv6Loopback }, async () => {
      const socket = dgram.createSocket({ type, lookup: lookupAnswers("host.invalid", address) });
      try {
        assert.deepStrictEqual(await bind(socket, 0, "host.invalid"), {
          address: address === "0:0:0:0:0:0:0:1" ? "::1" : address,
          family,
        });
      } finally {
        socket.close();
      }
    });
  }

  // Node.js reads a C string, so it binds the text in front of a NUL. Bun refuses the text, as for connect() and
  // send(). Each runtime is held to its own answer.
  test("udp4: a lookup that returns an address, a NUL and more text", async () => {
    const socket = dgram.createSocket({ type: "udp4", lookup: lookupAnswers("host.invalid", "127.0.0.1\0rebound") });
    try {
      const expected =
        typeof Bun !== "undefined" ? bindError("127.0.0.1\0rebound") : { address: "127.0.0.1", family: "IPv4" };
      assert.deepStrictEqual(await bind(socket, 0, "host.invalid"), expected);
    } finally {
      socket.close();
    }
  });
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
