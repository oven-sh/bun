import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isIPv6, isMacOS, isWindows } from "harness";
import * as dgram from "node:dgram";
import { once } from "node:events";
import * as net from "node:net";

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

describe("node:dgram blockList options", () => {
  test("createSocket validates receiveBlockList / sendBlockList type", () => {
    expect(() => dgram.createSocket({ type: "udp4", receiveBlockList: 42 })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    expect(() => dgram.createSocket({ type: "udp4", sendBlockList: "nope" })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    // Falsy values are ignored, a real BlockList is accepted.
    const ok = dgram.createSocket({
      type: "udp4",
      receiveBlockList: undefined,
      sendBlockList: new net.BlockList(),
    });
    ok.close();
  });

  test("receiveBlockList drops matching inbound datagrams before 'message'", async () => {
    const blockList = new net.BlockList();
    blockList.addAddress("127.0.0.1");
    const rx = dgram.createSocket({ type: "udp4", receiveBlockList: blockList });
    const tx = dgram.createSocket("udp4");
    try {
      const received = [];
      rx.on("message", (d, rinfo) => received.push({ msg: String(d), from: rinfo.address }));
      await new Promise((resolve, reject) => {
        rx.once("error", reject);
        rx.bind(0, "127.0.0.1", resolve);
      });
      const port = rx.address().port;
      await new Promise((resolve, reject) => tx.send("blocked", port, "127.0.0.1", e => (e ? reject(e) : resolve())));
      // Marker: deliver to a second, unfiltered receiver on the same loopback
      // path so we know datagram dispatch has run, then assert rx saw nothing.
      const marker = dgram.createSocket("udp4");
      try {
        const markerGot = once(marker, "message");
        await new Promise((resolve, reject) => {
          marker.once("error", reject);
          marker.bind(0, "127.0.0.1", resolve);
        });
        await new Promise((resolve, reject) =>
          tx.send("marker", marker.address().port, "127.0.0.1", e => (e ? reject(e) : resolve())),
        );
        await markerGot;
      } finally {
        marker.close();
      }
      for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
      expect(received).toEqual([]);
    } finally {
      try {
        rx.close();
      } catch {}
      try {
        tx.close();
      } catch {}
    }
  });

  test("sendBlockList: send() to blocked destination fails with ERR_IP_BLOCKED and nothing is sent", async () => {
    const blockList = new net.BlockList();
    blockList.addAddress("127.0.0.1");
    const rx = dgram.createSocket("udp4");
    const tx = dgram.createSocket({ type: "udp4", sendBlockList: blockList });
    try {
      const received = [];
      rx.on("message", d => received.push(String(d)));
      await new Promise((resolve, reject) => {
        rx.once("error", reject);
        rx.bind(0, "127.0.0.1", resolve);
      });
      const port = rx.address().port;

      const cbErr = await new Promise(resolve => tx.send("blocked-out", port, "127.0.0.1", e => resolve(e)));
      expect(cbErr).toBeInstanceOf(Error);
      expect(cbErr.code).toBe("ERR_IP_BLOCKED");

      // Without a callback the error is emitted on the socket.
      const emitted = once(tx, "error");
      tx.send("blocked-out-2", port, "127.0.0.1");
      const [emittedErr] = await emitted;
      expect(emittedErr.code).toBe("ERR_IP_BLOCKED");

      // Sending to an allowed destination still works and proves nothing blocked reached rx.
      const allow = new net.BlockList();
      allow.addAddress("10.0.0.1");
      const tx2 = dgram.createSocket({ type: "udp4", sendBlockList: allow });
      try {
        const gotAllowed = once(rx, "message");
        await new Promise((resolve, reject) =>
          tx2.send("allowed", port, "127.0.0.1", e => (e ? reject(e) : resolve())),
        );
        await gotAllowed;
      } finally {
        tx2.close();
      }
      for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
      expect(received).toEqual(["allowed"]);
    } finally {
      try {
        rx.close();
      } catch {}
      try {
        tx.close();
      } catch {}
    }
  });

  test("sendBlockList: connect() to blocked destination fails with ERR_IP_BLOCKED", async () => {
    const blockList = new net.BlockList();
    blockList.addAddress("127.0.0.1");
    const rx = dgram.createSocket("udp4");
    const tx = dgram.createSocket({ type: "udp4", sendBlockList: blockList });
    try {
      await new Promise((resolve, reject) => {
        rx.once("error", reject);
        rx.bind(0, "127.0.0.1", resolve);
      });
      const port = rx.address().port;
      const err = await new Promise(resolve => tx.connect(port, "127.0.0.1", e => resolve(e)));
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_IP_BLOCKED");
    } finally {
      try {
        rx.close();
      } catch {}
      try {
        tx.close();
      } catch {}
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
