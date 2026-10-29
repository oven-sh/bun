/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * bind() and listen() hand the address to the handle, and the handle reads it
 * with libuv's uv_ip4_addr() or uv_ip6_addr(). No resolver sees it.
 * uv_ip6_addr() takes a `%zone` that names an interface, and reads a name
 * that no interface has as no zone. The kernel then refuses a link-local
 * address with no zone:
 * https://github.com/nodejs/node/blob/v26.3.0/deps/uv/src/uv-common.c#L265-L297
 * https://github.com/nodejs/node/blob/v26.3.0/src/udp_wrap.cc#L303-L335
 * https://github.com/nodejs/node/blob/v26.3.0/src/tcp_wrap.cc#L375-L416
 */
import assert from "node:assert";
import { execFile } from "node:child_process";
import dgram from "node:dgram";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const isWindows = process.platform === "win32";
const isLinux = process.platform === "linux";
const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, addresses]) =>
  (addresses ?? []).map(address => ({ name, ...address })),
);
// "lo" or "lo0". Read from the interfaces and not from a bind, which is what these tests are about.
const loopbackInterface = interfaces.find(({ address }) => address === "::1")?.name;
// CI hosts can be without IPv6, and every test here needs a socket on ::1.
const skip = loopbackInterface === undefined;
// On Windows uv_ip6_addr() reads a zone as the index of the interface, and anything else as no zone.
// "1" is no interface name, so it is no zone in Node.js. Bun reads such a number as an index, which ::1 ignores.
const zones = [...(isWindows ? [] : [loopbackInterface]), "nosuch0", "1"];
// A link-local address of this host, with the zone that reaches it.
const linkLocal = interfaces.find(({ address, internal }) => address.startsWith("fe80:") && !internal);
const linkLocalHost = linkLocal && `${linkLocal.address}%${isWindows ? linkLocal.scopeid : linkLocal.name}`;

// The environment of a child process: without the debug logs of a debug build of Bun.
const env = typeof Bun !== "undefined" ? (await import("harness")).bunEnv : process.env;

type AddressError = NodeJS.ErrnoException & { address?: string };

// What bind() or listen() did: the address of the handle at 'listening', or the 'error'.
function settled(handle: dgram.Socket | net.Server) {
  return new Promise<{ address: string; family: string; port: number } | Record<string, unknown>>(resolve => {
    handle.once("error", ({ code, syscall, address, message }: AddressError) =>
      resolve({ code, syscall, address, message }),
    );
    handle.once("listening", () => resolve({ ...(handle.address() as net.AddressInfo) }));
  });
}

describe("an IPv6 address with a zone", () => {
  for (const zone of zones) {
    const host = `::1%${zone}`;

    test(`dgram: bind(0, "${host}") binds ::1`, { skip }, async () => {
      const socket = dgram.createSocket("udp6");
      try {
        const bound = settled(socket);
        socket.bind(0, host);
        const address = await bound;
        assert.deepStrictEqual(address, { address: "::1", family: "IPv6", port: address.port });
      } finally {
        socket.close();
      }
    });

    test(`net: listen(0, "${host}") listens on ::1 and accepts a connection`, { skip }, async () => {
      const server = net.createServer(socket => socket.end("hello"));
      try {
        const listening = settled(server);
        server.listen(0, host);
        const address = await listening;
        assert.deepStrictEqual(address, { address: "::1", family: "IPv6", port: address.port });
        const client = net.connect(address.port as number, "::1");
        const chunks: Buffer[] = [];
        client.on("data", chunk => chunks.push(chunk));
        await once(client, "close");
        assert.strictEqual(Buffer.concat(chunks).toString(), "hello");
      } finally {
        server.close();
      }
    });

    test(`http: listen(0, "${host}") listens on ::1 and answers a request`, { skip }, async () => {
      const server = http.createServer((_req, res) => res.end("hello"));
      try {
        const listening = settled(server);
        server.listen(0, host);
        const address = await listening;
        assert.deepStrictEqual(address, { address: "::1", family: "IPv6", port: address.port });
        const response = await fetch(`http://[::1]:${address.port}/`);
        assert.strictEqual(await response.text(), "hello");
      } finally {
        server.close();
      }
    });
  }

  // What the `multicast-dns` package does for `{ type: "udp6", interface: "::%eth0" }`: it binds the
  // interface option, then joins the group and sends on that interface.
  test(
    'dgram: bind(0, "::%<loopback>") binds ::, then joins a group on that interface',
    { skip: skip || isWindows },
    async () => {
      const host = `::%${loopbackInterface}`;
      const socket = dgram.createSocket({ type: "udp6", reuseAddr: true });
      try {
        const bound = settled(socket);
        socket.bind(0, host);
        const address = await bound;
        assert.deepStrictEqual(address, { address: "::", family: "IPv6", port: address.port });
        socket.addMembership("ff02::fb", host);
        socket.setMulticastInterface(host);
      } finally {
        socket.close();
      }
    },
  );

  // The primary binds the address for the worker. With SCHED_NONE the worker also gets the TCP socket itself.
  // No UDP socket is shared with a worker on Windows.
  const kinds = isWindows ? ["net"] : ["net", "dgram"];
  for (const policy of ["rr", "none"]) {
    const host = `::1%${zones[0]}`;
    test(
      `cluster worker (${policy}): ${kinds.join(" and ")} on "${host}" get ::1 from the primary`,
      { skip },
      async () => {
        const fixture = fileURLToPath(new URL("./node-bind-listen-zone-fixture.js", import.meta.url));
        const { stdout } = await promisify(execFile)(process.execPath, [fixture, host, kinds.join()], {
          env: { ...env, NODE_CLUSTER_SCHED_POLICY: policy },
        });
        assert.deepStrictEqual(
          JSON.parse(stdout),
          Object.fromEntries(kinds.map(kind => [kind, { address: "::1", family: "IPv6" }])),
        );
      },
    );
  }

  // A link-local address shows which zone the kernel got. Linux answers EINVAL with no zone, and
  // EADDRNOTAVAIL with the zone of an interface that does not have the address.
  for (const [zone, code, description] of [
    ["nosuch0", "EINVAL", "invalid argument"],
    [loopbackInterface, "EADDRNOTAVAIL", "address not available"],
  ]) {
    const host = `fe80::1%${zone}`;

    test(`dgram: bind(0, "${host}") is the ${code} of bind(2)`, { skip: skip || !isLinux }, async () => {
      const socket = dgram.createSocket("udp6");
      try {
        const bound = settled(socket);
        socket.bind(0, host);
        assert.deepStrictEqual(await bound, { code, syscall: "bind", address: host, message: `bind ${code} ${host}` });
      } finally {
        socket.close();
      }
    });

    test(`net: listen(0, "${host}") is the ${code} of bind(2)`, { skip: skip || !isLinux }, async () => {
      const server = net.createServer();
      const listening = settled(server);
      server.listen(0, host);
      assert.deepStrictEqual(await listening, {
        code,
        syscall: "listen",
        address: host,
        message: `listen ${code}: ${description} ${host}`,
      });
    });
  }

  // Node.js prints the zone of a link-local address and Bun does not, so only the address is compared.
  test(
    "dgram and net: a link-local address of this host binds with its zone",
    { skip: linkLocalHost === undefined },
    async () => {
      const socket = dgram.createSocket("udp6");
      const server = net.createServer();
      try {
        const bound = settled(socket);
        socket.bind(0, linkLocalHost!);
        const listening = settled(server);
        server.listen(0, linkLocalHost!);
        for (const { address, family } of [await bound, await listening]) {
          assert.deepStrictEqual(
            { address: String(address).split("%")[0], family },
            { address: linkLocal!.address, family: "IPv6" },
          );
        }
      } finally {
        socket.close();
        server.close();
      }
    },
  );
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { nodeExeAtLeast } = await import("harness");
  // The expected values above are those of v26.3.0.
  const node = nodeExeAtLeast("26.3.0");

  describe("Node.js compatibility", () => {
    // Without ::1 Node.js skips every test above, and that run proves nothing.
    test("all tests pass in Node.js", { skip: skip || !node }, async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, fileURLToPath(import.meta.url)],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
