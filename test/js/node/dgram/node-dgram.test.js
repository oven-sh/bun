import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isIPv6, isMacOS, isWindows } from "harness";
import * as dgram from "node:dgram";

// close() from inside a 'message' handler must stop delivery of the remaining
// datagrams in the current recvmmsg batch. Node guarantees no 'message' fires
// after 'close'; previously bun replayed the rest of the batch into a handle
// whose 'close' event and close() callback had already fired.
test("node:dgram close() inside 'message' handler stops remaining batch datagrams", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import dgram from "node:dgram";
      const trace = [];
      const rx = dgram.createSocket("udp4");
      await new Promise(r => rx.bind(0, "127.0.0.1", r));
      const port = rx.address().port;
      rx.on("message", d => {
        trace.push("message:" + d.toString());
        if (d.toString() === "0") rx.close(() => trace.push("closeCallback"));
      });
      rx.on("close", () => trace.push("closeEvent"));
      const tx = dgram.createSocket("udp4");
      tx.on("error", () => {});
      // Queue a burst on the kernel rx buffer before the loop dispatches
      // 'message'. Each send is awaited so its syscall has completed before
      // the next one starts; on loopback this deterministically yields a
      // multi-packet recvmmsg batch.
      for (let i = 0; i < 16; i++) {
        await new Promise(r => tx.send(String(i), port, "127.0.0.1", r));
      }
      // Let any queued 'message' / 'close' events drain.
      for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r));
      tx.close();
      console.log(JSON.stringify(trace));
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const stderr = rawStderr
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  const trace = JSON.parse(stdout.trim());
  // The socket closes on the first datagram. Node ordering: 'close' event
  // first, then the close() callback (both via queueMicrotask in dgram.ts).
  expect({ stderr, trace }).toEqual({
    stderr: "",
    trace: ["message:0", "closeEvent", "closeCallback"],
  });
  expect(exitCode).toBe(0);
});

// Node rejects an interface address that doesn't parse as an IP with EINVAL
// (uv_udp_set_membership → uv_ip4_addr/uv_ip6_addr). Previously bun silently
// dropped the argument and joined on the kernel-default interface.
describe("node:dgram membership with unparseable interface", () => {
  const ifaces = ["eth0", "i", Buffer.alloc(15, "i").toString(), Buffer.alloc(300, "i").toString(), ""];

  test("addMembership throws EINVAL", async () => {
    const s = dgram.createSocket("udp4");
    try {
      await new Promise((resolve, reject) => {
        s.once("error", reject);
        s.bind(0, "0.0.0.0", resolve);
      });
      const results = ifaces.map(iface => {
        try {
          s.addMembership("224.0.7.40", iface);
          return { len: iface.length, code: null };
        } catch (e) {
          return { len: iface.length, code: e.code };
        }
      });
      expect(results).toEqual(ifaces.map(iface => ({ len: iface.length, code: "EINVAL" })));
    } finally {
      s.close();
    }
  });

  test("dropMembership throws EINVAL", async () => {
    const s = dgram.createSocket("udp4");
    try {
      await new Promise((resolve, reject) => {
        s.once("error", reject);
        s.bind(0, "0.0.0.0", resolve);
      });
      const results = ifaces.map(iface => {
        try {
          s.dropMembership("224.0.7.40", iface);
          return { len: iface.length, code: null };
        } catch (e) {
          return { len: iface.length, code: e.code };
        }
      });
      expect(results).toEqual(ifaces.map(iface => ({ len: iface.length, code: "EINVAL" })));
    } finally {
      s.close();
    }
  });

  test("addSourceSpecificMembership/dropSourceSpecificMembership throw EINVAL", async () => {
    const s = dgram.createSocket("udp4");
    try {
      await new Promise((resolve, reject) => {
        s.once("error", reject);
        s.bind(0, "0.0.0.0", resolve);
      });
      const results = [];
      for (const fn of ["addSourceSpecificMembership", "dropSourceSpecificMembership"]) {
        for (const iface of ifaces) {
          try {
            s[fn]("10.0.0.1", "232.1.1.1", iface);
            results.push({ fn, len: iface.length, code: null });
          } catch (e) {
            results.push({ fn, len: iface.length, code: e.code });
          }
        }
      }
      expect(results).toEqual(
        ["addSourceSpecificMembership", "dropSourceSpecificMembership"].flatMap(fn =>
          ifaces.map(iface => ({ fn, len: iface.length, code: "EINVAL" })),
        ),
      );
    } finally {
      s.close();
    }
  });
});

describe.skipIf(!isIPv6())("node:dgram", () => {
  it("adds membership successfully (IPv6)", () => {
    const socket = makeSocket6();
    socket.bind(0, () => {
      socket.addMembership("ff01::1", getInterface());
      if (!isMacOS) {
        // macOS seems to be iffy with automatically choosing an interface.
        socket.addMembership("ff02::1");
      }
    });
  });

  it("doesn't add membership given invalid inputs (IPv6)", () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    const socket = makeSocket6();
    socket.bind(0, () => {
      expect(() => {
        // fe00:: is not a valid multicast address
        socket.addMembership("fe00::", getInterface());
        reject();
      }).toThrow();
      expect(() => {
        socket.addMembership("fe00::");
        reject();
      }).toThrow();
      resolve();
    });
    return promise;
  });
});

function makeSocket6() {
  return dgram.createSocket({
    type: "udp6",
    ipv6Only: true,
  });
}

function getInterface() {
  if (isWindows) {
    return "::%1";
  }

  if (isMacOS) {
    return "::%lo0";
  }

  return "::%lo";
}
