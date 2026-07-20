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

test("createSocket receiveBlockList/sendBlockList validation error matches Node.js", () => {
  expect(() => dgram.createSocket({ type: "udp4", receiveBlockList: {} })).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: 'The "options.receiveBlockList" property must be an net.BlockList. Received an instance of Object',
    }),
  );
  expect(() => dgram.createSocket({ type: "udp4", sendBlockList: {} })).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: 'The "options.sendBlockList" property must be an net.BlockList. Received an instance of Object',
    }),
  );
});
