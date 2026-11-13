// Extra cases for the dial of a name with several addresses (RFC 8305 §5).
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, isWindows } from "harness";

async function run(body: string, timeoutMs = 10_000) {
  const fixture = /* js */ `
    const { dnsCacheSeed } = require("bun:internal-for-testing");
    if (typeof dnsCacheSeed !== "function") {
      // A released binary without the hook must FAIL, not skip.
      console.log(JSON.stringify({ ok: false, err: "dnsCacheSeed unavailable" }));
      process.exit(0);
    }
    ${body}
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: {
      ...bunEnv,
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      http_proxy: undefined,
      https_proxy: undefined,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  clearTimeout(timer);
  let out: any;
  try {
    out = JSON.parse(stdout.trim());
  } catch {
    out = { unparseableStdout: stdout };
  }
  return { out, stderr, exitCode, signal: proc.signalCode };
}

// What the fixtures below share. Nothing here needs libc.
const dialPrelude = /* js */ `
// Resolves once condition() holds.
function until(condition) {
  return new Promise(resolve => {
    const timer = setInterval(() => {
      if (!condition()) return;
      clearInterval(timer);
      resolve();
    }, 1);
  });
}
// Resolves to a failure once ms have passed, so that a dial that hangs is a result and not a timeout.
function deadline(ms) {
  return new Promise(resolve => setTimeout(resolve, ms, "no connection after " + ms + " ms"));
}
// A listener that counts its connections and answers a request with "ok".
// It leaves the close to the client, so a connection it counts as closed is
// closed on both ends.
function countingListener(hostname, port) {
  const counter = { hostname, port, accepted: 0, closed: 0 };
  const listener = Bun.listen({
    hostname,
    port,
    socket: {
      open() { counter.accepted++; },
      data(socket) { socket.write("HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\nConnection: close\\r\\n\\r\\nok"); },
      close() { counter.closed++; },
      error() {},
    },
  });
  counter.port = listener.port;
  counter.stop = () => listener.stop(true);
  return counter;
}
// Bun.connect() to hostname:port. Resolves to the address that answered, or to the error code.
function dial(hostname, port) {
  const { promise, resolve } = Promise.withResolvers();
  Bun.connect({
    hostname,
    port,
    socket: {
      open(socket) { resolve(socket.remoteAddress); socket.end(); },
      connectError(socket, err) { resolve(err?.code ?? String(err)); },
      data() {},
      error() {},
    },
  }).catch(err => resolve(err?.code ?? String(err)));
  return promise;
}
// A listener accepts in arrival order. Once it has answered this request to
// its literal address, it has counted every connection opened before.
async function acceptedBy(counter) {
  await (await fetch("http://" + counter.hostname + ":" + counter.port + "/", { keepalive: false })).text();
  return counter.accepted - 1;
}
`;

// The backlog-0 trick and 127.0.0.0/8-on-lo are Linux-specific; the raw setup
// dlopens glibc. listen(fd, 0) + a full one-slot accept queue makes the kernel
// drop every further SYN to ip:port, the same EINPROGRESS-forever a filtered
// network produces.
const blackholePrelude = /* js */ `
${dialPrelude}
const { dlopen } = require("bun:ffi");
const libc = dlopen("libc.so.6", {
  socket:   { args: ["int","int","int"],           returns: "int" },
  bind:     { args: ["int","ptr","int"],           returns: "int" },
  listen:   { args: ["int","int"],                 returns: "int" },
  connect:  { args: ["int","ptr","int"],           returns: "int" },
  close:    { args: ["int"],                       returns: "int" },
  setsockopt:{args: ["int","int","int","ptr","int"],returns:"int" },
});
const AF_INET=2, SOCK_STREAM=1, SOCK_NONBLOCK=0o4000, SOL_SOCKET=1, SO_REUSEADDR=2;
function sockaddr_in(ip, port) {
  const b = new Uint8Array(16);
  new DataView(b.buffer).setUint16(0, AF_INET, true);
  b[2] = (port>>8)&0xff; b[3] = port&0xff;
  const o = ip.split(".").map(Number); b[4]=o[0]; b[5]=o[1]; b[6]=o[2]; b[7]=o[3];
  return b;
}
const fds = [];
function blackhole(ip, port) {
  const fd = libc.symbols.socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) throw new Error("socket() failed");
  fds.push(fd);
  const one = new Int32Array([1]);
  libc.symbols.setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, one, 4);
  if (libc.symbols.bind(fd, sockaddr_in(ip, port), 16) !== 0)
    throw new Error("bind(" + ip + ":" + port + ") failed");
  if (libc.symbols.listen(fd, 0) !== 0) throw new Error("listen() failed");
  for (let i = 0; i < 8; i++) {
    const c = libc.symbols.socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK, 0);
    fds.push(c);
    libc.symbols.connect(c, sockaddr_in(ip, port), 16);
  }
  return fd;
}
// A pending connect attempt is one more descriptor of this process.
const openFds = () => require("node:fs").readdirSync("/proc/self/fd").length;
`;

describe("dial of a name with several addresses", () => {
  // Runs on every platform, so it cannot use a black hole. Nothing listens on
  // the first four addresses. Linux refuses them at once. Windows retries a
  // refused SYN for about two seconds to any address but 127.0.0.1 and ::1,
  // and macOS has no 127.0.0.2: there the fifth address starts because the
  // delay elapsed.
  test("Bun.connect() reaches a fifth address that is the only one to answer", async () => {
    const { out, stderr, exitCode, signal } = await run(/* js */ `
      ${dialPrelude}
      const net = require("node:net");
      const dead = ["127.0.0.2", "127.0.0.3", "127.0.0.4", "127.0.0.5"];
      // A socket bound to address:port with no listener. Another process that
      // binds port 0 there is not given this port while it is held. Nothing is
      // held where the address cannot be bound: no process listens there.
      function hold(address, port) {
        let helper;
        try {
          helper = Bun.listen({ hostname: address, port: 0, socket: { data() {} } });
        } catch {
          return;
        }
        return new Promise((resolve, reject) => {
          const socket = net.connect({ host: address, port: helper.port, localAddress: address, localPort: port });
          socket.once("connect", () => resolve(socket));
          socket.once("error", reject);
        });
      }
      let live;
      for (;;) {
        live = countingListener("127.0.0.1", 0);
        try {
          await Promise.all(dead.map(address => hold(address, live.port)));
          break;
        } catch (e) {
          if (e.code !== "EADDRINUSE") throw e;
          live.stop();
        }
      }
      const port = live.port;
      const host = "he-five-" + port + ".test";
      dnsCacheSeed(host, [...dead, "127.0.0.1"]);

      // The same connect to the first address alone, to compare with.
      const events = [];
      const literal = Promise.withResolvers();
      const refused = () => { events.push("literal refused"); literal.resolve(); };
      Bun.connect({
        hostname: dead[0],
        port,
        socket: { open(socket) { socket.end(); }, connectError: refused, data() {}, error() {} },
      }).catch(() => {});
      const remote = await Promise.race([dial(host, port), deadline(8000)]);
      events.push("name open");
      // Only Windows is sure to refuse the literal connect, and later than the delay.
      if (process.platform === "win32") await literal.promise;
      console.log(JSON.stringify({ remote, events: process.platform === "win32" ? events : undefined }));
      process.exit(0);
    `);
    expect({ out, stderr, exitCode, signal }).toEqual({
      out: isWindows ? { remote: "127.0.0.1", events: ["name open", "literal refused"] } : { remote: "127.0.0.1" },
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  });

  describe.concurrent("with addresses that do not answer", () => {
    test.skipIf(!isLinux || isMusl)(
      "fetch() reaches the address behind two silent and twenty refused ones",
      async () => {
        const { out, stderr, exitCode, signal } = await run(
          /* js */ `
          ${blackholePrelude}
          using server = Bun.serve({ port: 0, hostname: "127.0.0.30", fetch: () => new Response("ok via 127.0.0.30") });
          const port = server.port;
          blackhole("127.0.0.2", port);
          blackhole("127.0.0.3", port);
          // Nothing listens on the next twenty: connect() to each fails at once.
          const refused = Array.from({ length: 20 }, (_, i) => "127.0.0." + (4 + i));
          const host = "he-refused-" + port + ".test";
          dnsCacheSeed(host, ["127.0.0.2", "127.0.0.3", ...refused, "127.0.0.30"]);

          let result;
          try {
            const res = await fetch("http://" + host + ":" + port + "/", { signal: AbortSignal.timeout(4000) });
            result = { body: await res.text() };
          } catch (e) {
            result = { err: e?.name ?? String(e) };
          }
          console.log(JSON.stringify(result));
          process.exit(0);
        `,
          20_000,
        );
        expect({ out, stderr, exitCode, signal }).toEqual({
          out: { body: "ok via 127.0.0.30" },
          stderr: "",
          exitCode: 0,
          signal: null,
        });
      },
      20_000,
    );

    // Every address that does not answer adds a pending attempt. A socket with
    // a 16 s timeout (four turns of the 4 s timeout wheel) must not time out
    // because the delay of a dial elapsed five times.
    test.skipIf(!isLinux || isMusl)(
      "a dial that waits out five delays does not time another socket out",
      async () => {
        const { out, stderr, exitCode, signal } = await run(
          /* js */ `
          ${blackholePrelude}
          const live = countingListener("127.0.0.10", 0);
          const port = live.port;
          const dead = ["127.0.0.2", "127.0.0.3", "127.0.0.4", "127.0.0.5", "127.0.0.6"];
          for (const ip of dead) blackhole(ip, port);
          const host = "he-wheel-" + port + ".test";
          dnsCacheSeed(host, [...dead, "127.0.0.10"]);

          let timedOut = false;
          const idle = await Bun.connect({
            hostname: "127.0.0.10",
            port,
            socket: { timeout() { timedOut = true; }, data() {}, error() {} },
          });
          idle.timeout(16);
          const remote = await Promise.race([dial(host, port), deadline(8000)]);
          console.log(JSON.stringify({ remote, timedOut }));
          process.exit(0);
        `,
          20_000,
        );
        expect({ out, stderr, exitCode, signal }).toEqual({
          out: { remote: "127.0.0.10", timedOut: false },
          stderr: "",
          exitCode: 0,
          signal: null,
        });
      },
      20_000,
    );

    // Every dial on a loop shares one deadline, the earliest of their delays.
    test.skipIf(!isLinux || isMusl)(
      "dials that wait at the same time each reach their live address",
      async () => {
        const { out, stderr, exitCode, signal } = await run(
          /* js */ `
          ${blackholePrelude}
          const live = countingListener("127.0.0.6", 0);
          const port = live.port;
          const dead = ["127.0.0.2", "127.0.0.3", "127.0.0.4", "127.0.0.5"];
          for (const ip of dead) blackhole(ip, port);
          const slowDial = label => {
            const name = "he-overlap-" + label + "-" + port + ".test";
            dnsCacheSeed(name, [...dead, "127.0.0.6"]);
            return Promise.race([dial(name, port), deadline(8000)]);
          };
          // Five addresses that answer: this dial has a delay scheduled until it connects.
          const healthy = "he-overlap-healthy-" + port + ".test";
          dnsCacheSeed(healthy, Array(5).fill("127.0.0.6"));

          // Two dials wait behind the silent addresses, the second one scheduled
          // after the first. A healthy dial starts and ends beside each of them.
          const before = openFds();
          const first = slowDial("first");
          await until(() => openFds() > before);
          const besideFirst = await dial(healthy, port);
          const second = slowDial("second");
          const besideBoth = await dial(healthy, port);

          // Healthy dials keep starting, each with a later delay, until both
          // of the dials that wait have connected.
          let pair;
          Promise.all([first, second]).then(remotes => (pair = remotes));
          const started = performance.now();
          while (!pair && performance.now() - started < 4000) {
            await dial(healthy, port);
            await until(() => live.closed === live.accepted);
          }
          console.log(JSON.stringify({ besideFirst, besideBoth, pair }));
          process.exit(0);
        `,
          20_000,
        );
        expect({ out, stderr, exitCode, signal }).toEqual({
          out: { besideFirst: "127.0.0.6", besideBoth: "127.0.0.6", pair: ["127.0.0.6", "127.0.0.6"] },
          stderr: "",
          exitCode: 0,
          signal: null,
        });
      },
      20_000,
    );
  });
});
