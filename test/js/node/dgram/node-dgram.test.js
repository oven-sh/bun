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
      const closed = Promise.withResolvers();
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
      const tx = dgram.createSocket("udp4");
      tx.on("error", () => {});
      // Queue a burst on the kernel rx buffer before the loop dispatches
      // 'message': every send is started before the loop gets a turn. Where
      // loopback delivers during the send, as on Linux, that yields a
      // multi-packet recvmmsg batch.
      const sends = [];
      for (let i = 0; i < 16; i++) {
        sends.push(new Promise(r => tx.send(String(i), port, "127.0.0.1", r)));
      }
      await Promise.all(sends);
      // Nothing says when the datagrams arrive. The poll that dispatches the
      // first one would dispatch the rest of its batch, and is over a turn later.
      await closed.promise;
      await new Promise(r => setImmediate(r));
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

test.each([
  ["that the engine holds as a double", port => new Float64Array([port])[0]],
  ["that is a string", port => String(port)],
  ["that is a string in hexadecimal", port => "0x" + port.toString(16)],
])("node:dgram connect() takes a port %s", async (_, spell) => {
  await using server = dgram.createSocket("udp4");
  await using client = dgram.createSocket("udp4");
  await new Promise(resolve => server.bind(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const { promise, resolve, reject } = Promise.withResolvers();
  client.connect(spell(port), "127.0.0.1", error => (error ? reject(error) : resolve()));
  await promise;
  expect(client.remoteAddress().port).toBe(port);
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
