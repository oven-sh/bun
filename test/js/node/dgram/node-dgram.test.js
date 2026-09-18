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
      const closed = Promise.withResolvers();
      const rx = dgram.createSocket("udp4");
      await new Promise(r => rx.bind(0, "127.0.0.1", r));
      const port = rx.address().port;
      rx.on("message", d => {
        trace.push("message:" + d.toString());
        if (d.toString() === "0") {
          rx.close(() => {
            trace.push("closeCallback");
            closed.resolve();
          });
        }
      });
      rx.on("close", () => trace.push("closeEvent"));
      rx.on("error", closed.reject);
      const tx = dgram.createSocket("udp4");
      tx.on("error", closed.reject);
      // Queue a burst on the kernel rx buffer before the loop dispatches
      // 'message'. Each send is awaited so its syscall has completed before
      // the next one starts; on loopback this deterministically yields a
      // multi-packet recvmmsg batch.
      for (let i = 0; i < 16; i++) {
        await new Promise((r, j) => tx.send(String(i), port, "127.0.0.1", e => (e ? j(e) : r())));
      }
      // Loopback delivery is asynchronous on macOS, so wait for the close
      // itself, not for a number of loop turns. Then give a replay of the rest
      // of the batch a few turns to show up in the trace.
      await closed.promise;
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
  // The socket closes on the first datagram. Node ordering: 'close' event
  // first, then the close() callback (both via queueMicrotask in dgram.ts).
  // stdout stays a string so that a child error shows up in stderr here
  // instead of as a JSON.parse failure on empty output.
  expect({ stderr, stdout }).toEqual({
    stderr: "",
    stdout: JSON.stringify(["message:0", "closeEvent", "closeCallback"]) + "\n",
  });
  expect(exitCode).toBe(0);
});

test("node:dgram Symbol.asyncDispose closes the socket and resolves after 'close'", async () => {
  const socket = dgram.createSocket("udp4");
  await new Promise(resolve => socket.bind(0, "127.0.0.1", resolve));
  const events = [];
  socket.on("close", () => events.push("close"));
  await socket[Symbol.asyncDispose]();
  events.push("disposed");
  expect(events).toEqual(["close", "disposed"]);
  // The handle is gone, so disposing again resolves without touching the socket.
  await expect(socket[Symbol.asyncDispose]()).resolves.toBeUndefined();
  expect(() => socket.address()).toThrow(expect.objectContaining({ code: "ERR_SOCKET_DGRAM_NOT_RUNNING" }));
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
