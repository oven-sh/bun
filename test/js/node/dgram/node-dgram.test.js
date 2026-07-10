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
    // Barrier: the filter runs synchronously in the receive path, so once
    // check() has been called the 'message' emit has either happened or been
    // skipped in the same frame.
    const { promise: checked, resolve: onChecked } = Promise.withResolvers();
    const realCheck = blockList.check.bind(blockList);
    blockList.check = (addr, family) => {
      const r = realCheck(addr, family);
      onChecked({ addr, family, result: r });
      return r;
    };

    await using rx = dgram.createSocket({ type: "udp4", receiveBlockList: blockList });
    await using tx = dgram.createSocket("udp4");
    const received = [];
    const gotMessage = once(rx, "message");
    rx.on("message", (d, rinfo) => received.push({ msg: String(d), from: rinfo.address }));
    await new Promise((resolve, reject) => {
      rx.once("error", reject);
      rx.bind(0, "127.0.0.1", resolve);
    });
    const port = rx.address().port;
    await new Promise((resolve, reject) => tx.send("blocked", port, "127.0.0.1", e => (e ? reject(e) : resolve())));
    await Promise.race([checked, gotMessage]);
    expect(received).toEqual([]);
    const checkCall = await checked;
    expect({ addr: checkCall.addr, result: checkCall.result }).toEqual({ addr: "127.0.0.1", result: true });
  });

  test("sendBlockList: send() to blocked destination fails with ERR_IP_BLOCKED and nothing is sent", async () => {
    const blockList = new net.BlockList();
    blockList.addAddress("127.0.0.1");
    await using rx = dgram.createSocket("udp4");
    await using tx = dgram.createSocket({ type: "udp4", sendBlockList: blockList });
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

    // Without a callback Node drops the datagram silently (no 'error' event).
    const txErrors = [];
    tx.on("error", e => txErrors.push(e));
    tx.send("blocked-out-2", port, "127.0.0.1");

    // An allowed send reaches rx; once it arrives, rx has processed everything
    // addressed to it (the blocked sends never hit the wire).
    const allow = new net.BlockList();
    allow.addAddress("10.0.0.1");
    await using tx2 = dgram.createSocket({ type: "udp4", sendBlockList: allow });
    const gotAllowed = once(rx, "message");
    await new Promise((resolve, reject) => tx2.send("allowed", port, "127.0.0.1", e => (e ? reject(e) : resolve())));
    await gotAllowed;
    expect({ received, txErrors }).toEqual({ received: ["allowed"], txErrors: [] });
  });

  test("sendBlockList: connect() to blocked destination fails with ERR_IP_BLOCKED", async () => {
    const blockList = new net.BlockList();
    blockList.addAddress("127.0.0.1");
    await using rx = dgram.createSocket("udp4");
    await using tx = dgram.createSocket({ type: "udp4", sendBlockList: blockList });
    await new Promise((resolve, reject) => {
      rx.once("error", reject);
      rx.bind(0, "127.0.0.1", resolve);
    });
    const port = rx.address().port;
    const err = await new Promise(resolve => tx.connect(port, "127.0.0.1", e => resolve(e)));
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("ERR_IP_BLOCKED");
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
