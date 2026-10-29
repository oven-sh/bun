/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * libuv reads each address argument of the multicast calls with uv_ip4_addr()
 * or uv_ip6_addr(): an IP address written in full. The source and the
 * interface of a membership are read in the family of its group. libuv answers
 * UV_EINVAL for other text, and Node throws that with the name of the method:
 * https://github.com/libuv/libuv/blob/v1.52.1/src/uv-common.c#L254-L297
 * https://github.com/libuv/libuv/blob/v1.52.1/src/unix/udp.c#L747-L1089
 * https://github.com/nodejs/node/blob/v26.3.0/lib/dgram.js#L885-L960
 */
import assert from "node:assert";
import dgram from "node:dgram";
import { once } from "node:events";
import os from "node:os";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const H = "127.0.0.1";
const G = "239.255.255.250";
const S = "232.255.255.250";

// Each address argument of the five methods, with the other arguments written
// in full. A drop comes after the join that it undoes.
const positions: [method: string, args: string, full: string, call: (s: dgram.Socket, x: string) => void][] = [
  ["setMulticastInterface", "X", H, (s, x) => s.setMulticastInterface(x)],
  ["addMembership", "X, interface", G, (s, x) => s.addMembership(x, H)],
  ["addMembership", "group, X", H, (s, x) => s.addMembership(G, x)],
  ["dropMembership", "X, interface", G, (s, x) => (s.addMembership(G, H), s.dropMembership(x, H))],
  ["dropMembership", "group, X", H, (s, x) => (s.addMembership(G, H), s.dropMembership(G, x))],
  ["addSourceSpecificMembership", "X, group, interface", H, (s, x) => s.addSourceSpecificMembership(x, S, H)],
  ["addSourceSpecificMembership", "source, X, interface", S, (s, x) => s.addSourceSpecificMembership(H, x, H)],
  ["addSourceSpecificMembership", "source, group, X", H, (s, x) => s.addSourceSpecificMembership(H, S, x)],
  [
    "dropSourceSpecificMembership",
    "X, group, interface",
    H,
    (s, x) => (s.addSourceSpecificMembership(H, S, H), s.dropSourceSpecificMembership(x, S, H)),
  ],
  [
    "dropSourceSpecificMembership",
    "source, X, interface",
    S,
    (s, x) => (s.addSourceSpecificMembership(H, S, H), s.dropSourceSpecificMembership(H, x, H)),
  ],
  [
    "dropSourceSpecificMembership",
    "source, group, X",
    H,
    (s, x) => (s.addSourceSpecificMembership(H, S, H), s.dropSourceSpecificMembership(H, S, x)),
  ],
];

// What inet_aton() also reads as `full`: a last part of 16, 24 or 32 bits,
// hexadecimal, and octal.
function shorthand(full: string) {
  const [a, b, c, d] = full.split(".").map(Number);
  const bits = a * 2 ** 24 + (b << 16) + (c << 8) + d;
  return [
    `${a}.${b}.${(c << 8) + d}`,
    `${a}.${(b << 16) + (c << 8) + d}`,
    `${bits}`,
    `0x${bits.toString(16)}`,
    `0${a.toString(8)}.${b}.${c}.${d}`,
  ];
}

// What `call` returns on a bound socket of its own, or what it throws.
async function outcome(call: (socket: dgram.Socket) => unknown, type: dgram.SocketType = "udp4", address = H) {
  const socket = dgram.createSocket(type);
  socket.bind(0, address);
  await once(socket, "listening");
  try {
    return call(socket);
  } catch (e: any) {
    const { name, code, errno, syscall, message } = e;
    return { name, code, errno, syscall, message };
  } finally {
    socket.close();
    await once(socket, "close");
  }
}

const einval = (method: string) => ({
  name: "Error",
  code: "EINVAL",
  errno: isWindows ? -4071 : -22,
  syscall: method,
  message: `${method} EINVAL`,
});

for (const [method, args, full, call] of positions) {
  describe(`${method}(${args})`, () => {
    test("takes an address written in full", async () => {
      assert.strictEqual(await outcome(socket => call(socket, full)), undefined);
    });

    test("throws EINVAL for a shorthand, or for text that is not an address", async () => {
      const texts = [...shorthand(full), `${full} `, `${full}%lo`, "eth0"];
      const outcomes: [string, unknown][] = [];
      for (const text of texts) outcomes.push([text, await outcome(socket => call(socket, text))]);
      assert.deepStrictEqual(
        outcomes,
        texts.map(text => [text, einval(method)]),
      );
    });
  });
}

test("an interface that is not an address is not the default interface", async () => {
  assert.deepStrictEqual(
    {
      "addMembership, ''": await outcome(s => s.addMembership(G, "")),
      "dropMembership, ''": await outcome(s => (s.addMembership(G, H), s.dropMembership(G, ""))),
      "addSourceSpecificMembership, ''": await outcome(s => s.addSourceSpecificMembership(H, S, "")),
      "dropSourceSpecificMembership, ''": await outcome(
        s => (s.addSourceSpecificMembership(H, S, H), s.dropSourceSpecificMembership(H, S, "")),
      ),
      "an IPv6 group": await outcome(s => s.addMembership("ff02::7777", "eth0")),
    },
    {
      "addMembership, ''": einval("addMembership"),
      "dropMembership, ''": einval("dropMembership"),
      "addSourceSpecificMembership, ''": einval("addSourceSpecificMembership"),
      "dropSourceSpecificMembership, ''": einval("dropSourceSpecificMembership"),
      "an IPv6 group": einval("addMembership"),
    },
  );
});

test("the source and the interface are read in the family of the group", async () => {
  assert.deepStrictEqual(
    {
      "IPv4 group, IPv6 interface": await outcome(s => s.addMembership(G, "::1")),
      "IPv6 group, IPv4 interface": await outcome(s => s.dropMembership("ff02::7777", H)),
      "IPv4 group, IPv6 source": await outcome(s => s.addSourceSpecificMembership("::1", S, H)),
      "IPv6 group, IPv4 source": await outcome(s => s.dropSourceSpecificMembership(H, "ff3e::7777", "::")),
      "IPv4 source and group, IPv6 interface": await outcome(s => s.addSourceSpecificMembership(H, S, "::1")),
      "IPv6 source and group, IPv4 interface": await outcome(s =>
        s.dropSourceSpecificMembership("::1", "ff3e::7777", H),
      ),
    },
    {
      "IPv4 group, IPv6 interface": einval("addMembership"),
      "IPv6 group, IPv4 interface": einval("dropMembership"),
      "IPv4 group, IPv6 source": einval("addSourceSpecificMembership"),
      "IPv6 group, IPv4 source": einval("dropSourceSpecificMembership"),
      "IPv4 source and group, IPv6 interface": einval("addSourceSpecificMembership"),
      "IPv6 source and group, IPv4 interface": einval("dropSourceSpecificMembership"),
    },
  );
});

test("a setsockopt that fails is reported with the name of the method", async () => {
  const again = await outcome(s => (s.addMembership(G, H), s.addMembership(G, H)));
  const notMember: any = await outcome(s => s.dropMembership(G, H));
  assert.deepStrictEqual(
    [again, notMember],
    [
      // A second join of a group on the same interface. Winsock answers WSAEINVAL for it.
      isWindows
        ? einval("addMembership")
        : {
            name: "Error",
            code: "EADDRINUSE",
            errno: -os.constants.errno.EADDRINUSE,
            syscall: "addMembership",
            message: "addMembership EADDRINUSE",
          },
      {
        name: "Error",
        code: "EADDRNOTAVAIL",
        // On Windows the errno of a native error is not libuv's in Bun: see kUvErrors in src/js/node/dgram.ts.
        errno: isWindows && typeof notMember?.errno === "number" ? notMember.errno : -os.constants.errno.EADDRNOTAVAIL,
        syscall: "dropMembership",
        message: "dropMembership EADDRNOTAVAIL",
      },
    ],
  );
});

const hasIPv6Loopback = await new Promise<boolean>(resolve => {
  const probe = dgram.createSocket("udp6");
  probe.once("error", () => probe.close(() => resolve(false)));
  probe.bind(0, "::1", () => probe.close(() => resolve(true)));
});

// "an invalid Scope gets turned into #0 (default selection)": test-dgram-multicast-set-interface.js
test("a zone that names no interface is the default interface", { skip: !hasIPv6Loopback }, async () => {
  assert.deepStrictEqual(
    [
      await outcome(s => s.setMulticastInterface("::%nosuchzone0"), "udp6", "::1"),
      await outcome(s => s.setMulticastInterface("::%nosuchzone0 junk"), "udp6", "::1"),
    ],
    [undefined, undefined],
  );
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExeAtLeast } = await import("harness");
  // Node.js runs a TypeScript file as it is since v23.6.0.
  const node = nodeExeAtLeast("24.0.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--v8-pool-size=1", fileURLToPath(import.meta.url)],
        env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
