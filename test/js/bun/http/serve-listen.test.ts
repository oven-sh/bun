import { file, serve } from "bun";
import { clusterInternals, createSocketPair } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isIPv6, isLinux, isWindows, tempDir, tmpdirSync } from "harness";
import { closeSync, fstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import type { NetworkInterfaceInfo } from "node:os";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { inheritListener } from "./serve-listen-fd";

const networks = Object.values(networkInterfaces()).flat() as NetworkInterfaceInfo[];
const hasIPv4 = networks.some(({ family }) => family === "IPv4");
const hasIPv6 = networks.some(({ family }) => family === "IPv6");

const unix = join(tmpdirSync(), "unix.sock").replaceAll("\\", "/");
const tls = {
  cert: file(new URL("./fixtures/cert.pem", import.meta.url)),
  key: file(new URL("./fixtures/cert.key", import.meta.url)),
};

describe.each([
  {
    options: {
      hostname: undefined,
      port: 0,
    },
    url: {
      protocol: "http:",
    },
  },
  {
    options: {
      hostname: undefined,
      port: 0,
      tls,
    },
    url: {
      protocol: "https:",
    },
  },
  {
    options: {
      hostname: "localhost",
      port: 0,
    },
    hostname: "localhost",
    url: {
      protocol: "http:",
      hostname: "localhost",
    },
  },
  {
    options: {
      hostname: "localhost",
      port: 0,
      tls,
    },
    hostname: "localhost",
    url: {
      protocol: "https:",
      hostname: "localhost",
    },
  },
  {
    if: hasIPv4,
    options: {
      hostname: "127.0.0.1",
      port: 0,
    },
    hostname: "127.0.0.1",
    url: {
      protocol: "http:",
      hostname: "127.0.0.1",
    },
  },
  {
    if: hasIPv4,
    options: {
      hostname: "127.0.0.1",
      port: 0,
      tls,
    },
    hostname: "127.0.0.1",
    url: {
      protocol: "https:",
      hostname: "127.0.0.1",
    },
  },
  {
    if: hasIPv6,
    options: {
      hostname: "::1",
      port: 0,
    },
    hostname: "::1",
    url: {
      protocol: "http:",
      hostname: "[::1]",
    },
  },
  {
    if: hasIPv6,
    options: {
      hostname: "::1",
      port: 0,
      tls,
    },
    hostname: "::1",
    url: {
      protocol: "https:",
      hostname: "[::1]",
    },
  },
  {
    options: {
      unix: unix,
    },
    url: isWindows
      ? {
          protocol: "unix:",
          pathname: unix.substring(unix.indexOf(":") + 1),
          hostname: unix.substring(0, unix.indexOf(":")),
          port: "",
        }
      : {
          protocol: "unix:",
          pathname: unix,
        },
  },
])("Bun.serve()", ({ if: enabled = true, options, hostname, url }) => {
  const title = Bun.inspect(options).replaceAll("\n", " ");
  const unix = options.unix;

  describe.if(enabled)(title, () => {
    const server = serve({
      ...options,
      fetch() {
        return new Response();
      },
    });
    test(".hostname", () => {
      if (unix) {
        expect(server.hostname).toBeUndefined();
      } else if (hostname) {
        expect(server.hostname).toBe(hostname);
      } else {
        expect(server.hostname).toBeString();
      }
    });
    test(".port", () => {
      if (unix) {
        expect(server.port).toBeUndefined();
      } else {
        expect(server.port).toBeInteger();
        expect(server.port).toBeWithin(1, 65536 + 1);
      }
    });
    test(".url", () => {
      expect(server.url).toBeInstanceOf(URL);
      expect(server.url).toBe(server.url); // check if URL is properly cached
      const { protocol, hostname, port, pathname } = server.url;
      expect({ protocol, hostname, port, pathname }).toMatchObject(url);
    });
  });
});

// A name that cannot be a host name (a space, a colon, an empty label,
// brackets around anything but an IPv6 literal) is rejected in-process with the
// resolver's ENOTFOUND, the error Bun.connect reports for the same name. The
// system resolver is never asked: some DNS servers never answer a query for
// such a label, and the synchronous getaddrinfo behind listen() then blocks
// startup for its full timeout.
describe.each([
  ["http", {}],
  ["https", { tls }],
] as const)("Bun.serve() %s with a hostname that is not a hostname", (_, options) => {
  test.each(["this is not a hostname", "localhost:80", "a..b", "[not-an-ipv6]"])(
    "%p throws getaddrinfo ENOTFOUND",
    hostname => {
      let error: any;
      try {
        serve({ ...options, hostname, port: 0, fetch: () => new Response() }).stop(true);
      } catch (e) {
        error = e;
      }
      const { name, code, syscall, hostname: errHostname, message } = error ?? {};
      expect({ name, code, syscall, hostname: errHostname, message }).toEqual({
        name: "Error",
        code: "ENOTFOUND",
        syscall: "getaddrinfo",
        hostname,
        message: `getaddrinfo ENOTFOUND ${hostname}`,
      });
    },
  );

  test("a later Bun.serve() still binds", () => {
    using server = serve({ ...options, port: 0, fetch: () => new Response() });
    expect(server.port).toBeInteger();
  });
});

test.skipIf(!hasIPv6)("Bun.serve() binds a bracketed IPv6 literal hostname", () => {
  using server = serve({ hostname: "[::1]", port: 0, fetch: () => new Response() });
  expect({ hostname: server.hostname, urlHostname: server.url.hostname }).toEqual({
    hostname: "[::1]",
    urlHostname: "[::1]",
  });
});

// Linux-only: uses /proc/self/fd to find the listen socket and close it from
// under the server so getsockname() fails with EBADF.
test.skipIf(!isLinux)("server.address / server.port do not panic when getsockname() fails", async () => {
  const script = /* js */ `
    import { readdirSync, readlinkSync, closeSync } from "node:fs";

    function socketFds() {
      const out = new Set();
      for (const e of readdirSync("/proc/self/fd")) {
        let link = "";
        try { link = readlinkSync("/proc/self/fd/" + e); } catch {}
        if (link.startsWith("socket:")) out.add(Number(e));
      }
      return out;
    }

    const before = socketFds();
    const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    const boundPort = server.port;
    const after = socketFds();
    const newFds = [...after].filter(fd => !before.has(fd));

    if (newFds.length === 0) {
      console.log(JSON.stringify({ skipped: true }));
      server.stop(true);
      process.exit(0);
    }

    for (const fd of newFds) closeSync(fd);

    // These property reads must not abort the process.
    const address = server.address;
    const port = server.port;
    const url = String(server.url);

    console.log(JSON.stringify({ address, port, url, boundPort }));
    server.stop(true);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const out = JSON.parse(stdout.trim());
  if (out.skipped) return;

  // getsockname() failed, so the live query returns nothing; the configured
  // port (0) is all that's left. The important guarantees are: no crash, and
  // no out-of-range garbage (e.g. -1 or 65535) leaking through.
  expect({ address: out.address, port: out.port }).toEqual({ address: null, port: 0 });
  expect(out.url).not.toContain("65535");
  expect(out.url).not.toContain(":-1");
});

// A supervisor such as systemd binds the socket and the server inherits it. A
// Windows listener is a SOCKET handle and not a descriptor number, so `fd` is
// POSIX only.
describe.skipIf(isWindows)("Bun.serve({ fd })", () => {
  const fixture = join(import.meta.dir, "serve-listen-fd-fixture.ts");

  describe.concurrent("serves on a socket that the parent bound", () => {
    test.each([
      { kind: "tcp", tls: false },
      { kind: "tcp", tls: true },
      { kind: "unix", tls: false },
      { kind: "unix", tls: true },
      // An abstract socket has no file. Linux only.
      ...(isLinux ? [{ kind: "abstract", tls: false } as const] : []),
    ] as const)("$kind, tls: $tls", async ({ kind, tls }) => {
      await using child = await inheritListener({ fixture, kind, tls });
      const scheme = tls ? "https" : "http";
      expect(child.ready).toEqual(
        kind === "tcp"
          ? {
              url: `${scheme}://127.0.0.1:${child.port}/`,
              port: child.port,
              hostname: "127.0.0.1",
              address: { address: "127.0.0.1", family: "IPv4", port: child.port },
              newSockets: 0,
              class: tls ? "[object DebugHTTPSServer]" : "[object DebugHTTPServer]",
            }
          : {
              url: kind === "unix" ? `unix://${child.boundPath}` : `abstract://${child.nonce}/`,
              address: child.boundPath,
              newSockets: 0,
              class: tls ? "[object DebugHTTPSServer]" : "[object DebugHTTPServer]",
            },
      );
      expect(await child.request()).toEqual({ status: 200, body: "served by " + child.nonce });
      // `requestIP()` and `timeout()` answer null on a socket that has no IP address.
      expect(await child.request("/peer")).toEqual({
        status: 200,
        body:
          kind === "tcp"
            ? { requestIP: { address: "127.0.0.1", family: "IPv4", port: expect.any(Number) }, timeout: "undefined" }
            : { requestIP: null, timeout: "null" },
      });
      // `stop()` closes the descriptor. The socket file belongs to the process that bound it.
      expect(await child.stop()).toEqual({ fd: "EBADF", unlinked: kind === "unix" ? false : undefined });
    });

    test("a socket bound to the wildcard address reports localhost", async () => {
      await using child = await inheritListener({ fixture, kind: "wildcard" });
      expect(child.ready).toMatchObject({
        url: `http://localhost:${child.port}/`,
        port: child.port,
        hostname: "localhost",
        address: { address: "0.0.0.0", family: "IPv4", port: child.port },
        newSockets: 0,
      });
      expect(await child.request()).toEqual({ status: 200, body: "served by " + child.nonce });
    });

    test.skipIf(!isIPv6())("an IPv6 socket", async () => {
      await using child = await inheritListener({ fixture, kind: "tcp6" });
      expect(child.ready).toMatchObject({
        url: `http://[::1]:${child.port}/`,
        port: child.port,
        hostname: "::1",
        address: { address: "::1", family: "IPv6", port: child.port },
        newSockets: 0,
      });
      expect(await child.request()).toEqual({ status: 200, body: "served by " + child.nonce });
    });

    // Descriptor 0 is stdin. Bun never closes it, so the server listens on a duplicate.
    test("descriptor 0 stays open after stop()", async () => {
      await using child = await inheritListener({ fixture, kind: "tcp", fd: 0 });
      // The child counts its sockets on Linux only.
      expect(child.ready).toMatchObject({ port: child.port, newSockets: isLinux ? 1 : 0 });
      expect(await child.request()).toEqual({ status: 200, body: "served by " + child.nonce });
      expect(await child.stop()).toEqual({ fd: "open" });
    });

    // `fd` wins over a port, as `unix` does. A bind flag has no effect on a bound socket.
    test.each([
      ["port", { options: { port: 0 } }],
      ["reusePort", { options: { reusePort: true } }],
      ["ipv6Only", { options: { ipv6Only: true } }],
      ["$BUN_PORT", { env: { BUN_PORT: "0" } }],
      ["$PORT", { env: { PORT: "0" } }],
      ["$NODE_PORT", { env: { NODE_PORT: "0" } }],
      ["--port", { args: ["--port", "0"] }],
      // A cluster worker sets reusePort by default.
      ["$NODE_UNIQUE_ID", { env: { NODE_UNIQUE_ID: "1" } }],
    ] as const)("with %s", async (_, more) => {
      await using child = await inheritListener({ fixture, kind: "tcp", ...more });
      expect(child.ready).toMatchObject({ port: child.port, newSockets: 0 });
      expect(await child.request()).toEqual({ status: 200, body: "served by " + child.nonce });
    });

    test.each([
      { tls: false, class: "[object HTTPServer]" },
      { tls: true, class: "[object HTTPSServer]" },
    ])("in production, tls: $tls", async ({ tls, class: expected }) => {
      await using child = await inheritListener({ fixture, kind: "tcp", tls, env: { NODE_ENV: "production" } });
      expect(child.ready).toMatchObject({ port: child.port, newSockets: 0, class: expected });
      expect(await child.request()).toEqual({ status: 200, body: "served by " + child.nonce });
    });

    test("a WebSocket", async () => {
      await using child = await inheritListener({ fixture, kind: "tcp" });
      expect(await child.echo("hello")).toBe("echo hello");
    });

    test("a second listener on the descriptor throws and the first one serves", async () => {
      await using child = await inheritListener({ fixture, kind: "tcp", env: { LISTEN_TWICE: "1" } });
      expect(child.ready.second).toEqual({ code: "EEXIST", syscall: "listen", fd: 3 });
      expect(await child.request()).toEqual({ status: 200, body: "served by " + child.nonce });
    });

    // Each process accepts on the one socket. No rule says which process gets a connection.
    test("two processes on one socket", async () => {
      await using group = await inheritListener({ fixture, kind: "tcp", children: 2 });
      expect(group.allReady.map(ready => ready.port)).toEqual([group.port, group.port]);
      for (let i = 0; i < 8; i++) {
        expect(await group.request()).toEqual({ status: 200, body: "served by " + group.nonce });
      }
      await group.kill(0);
      expect(await group.request()).toEqual({ status: 200, body: "served by " + group.nonce });
    });
  });

  // The cluster primary makes such a socket for its workers.
  test("a socket that is bound and does not listen yet", async () => {
    const bound = clusterInternals.rawBind(4, "127.0.0.1", 0, 0);
    if (typeof bound === "number") throw new Error("bind failed with " + bound);
    // Nothing listens yet. Linux refuses the connection. On macOS the connection times out.
    if (isLinux) {
      await expect(fetch(`http://127.0.0.1:${bound.port}/`)).rejects.toMatchObject({ code: "ECONNREFUSED" });
    }
    let server: ReturnType<typeof serve> | undefined;
    try {
      server = serve({ fd: bound.fd, fetch: () => new Response("listening now") });
      expect({ port: server.port, hostname: server.hostname }).toEqual({ port: bound.port, hostname: "127.0.0.1" });
      expect(await (await fetch(`http://127.0.0.1:${bound.port}/`)).text()).toBe("listening now");
    } finally {
      // The server owns the descriptor from a listen that succeeds.
      if (server) server.stop(true);
      else clusterInternals.closeHandle(bound.fd);
    }
  });

  describe("throws for a descriptor that cannot listen and leaves it open", () => {
    // The status flags of an open descriptor. Linux only.
    function flags(fd: number) {
      if (!isLinux) return undefined;
      return /^flags:\s*(\d+)/m.exec(readFileSync(`/proc/self/fdinfo/${fd}`, "utf8"))?.[1];
    }

    function failedListen(fd: number) {
      const before = flags(fd);
      let server: ReturnType<typeof serve> | undefined;
      let error: any;
      try {
        server = serve({ fd, fetch: () => new Response() });
      } catch (e) {
        error = e;
      } finally {
        // An unfixed build ignores `fd` and binds a port.
        server?.stop(true);
      }
      return {
        error: { code: error?.code, syscall: error?.syscall, fd: error?.fd },
        flagsChanged: flags(fd) !== before,
        stillOpen: (() => {
          try {
            fstatSync(fd);
            return true;
          } catch {
            return false;
          }
        })(),
      };
    }

    test("a file", () => {
      const fd = openSync(import.meta.path, "r");
      try {
        expect(failedListen(fd)).toEqual({
          error: { code: "ENOTSOCK", syscall: "listen", fd },
          flagsChanged: false,
          stillOpen: true,
        });
      } finally {
        closeSync(fd);
      }
    });

    // `listen(2)` is not the judge here: it takes a SOCK_SEQPACKET socket too.
    test("a socket that is not a stream socket", async () => {
      const socket = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
      try {
        const fd = (socket as any).fd as number;
        expect(failedListen(fd)).toEqual({
          error: { code: "EINVAL", syscall: "listen", fd },
          flagsChanged: false,
          stillOpen: true,
        });
      } finally {
        socket.close();
      }
    });

    test("a connected socket", () => {
      const [fd, peer] = createSocketPair();
      try {
        expect(failedListen(fd)).toEqual({
          error: { code: "EINVAL", syscall: "listen", fd },
          flagsChanged: false,
          stillOpen: true,
        });
      } finally {
        closeSync(fd);
        closeSync(peer);
      }
    });

    test("a descriptor that is not open", () => {
      // Above every descriptor limit, so no other code in this process can open it.
      const fd = 0x7fffffff;
      expect(() => serve({ fd, fetch: () => new Response() })).toThrow(
        expect.objectContaining({ code: "EBADF", syscall: "listen", fd }),
      );
    });
  });

  // The second run finds the server of the first run by its `fd` and reloads
  // it. A second listen on the descriptor would fail.
  test("a --hot reload keeps the adopted socket", async () => {
    using dir = tempDir("fd-hot", {
      "server.ts": `
        globalThis.runs = (globalThis.runs ?? 0) + 1;
        const run = globalThis.runs;
        Bun.serve({ fd: 3, fetch: () => new Response("run " + run) });
        console.log("run " + run);
      `,
    });
    const donor = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = donor.port;
    await using child = Bun.spawn({
      cmd: [bunExe(), "--hot", "server.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit", donor.fd],
    });
    donor.stop(true);

    const lines = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
    let seen = "";
    async function untilRun(n: number) {
      while (!seen.includes(`run ${n}\n`)) {
        const { value, done } = await lines.read();
        if (done) throw new Error("the child exited. stdout: " + JSON.stringify(seen));
        seen += value;
      }
    }

    await untilRun(1);
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe("run 1");

    const file = join(String(dir), "server.ts");
    writeFileSync(file, readFileSync(file, "utf8") + "\n// changed\n");
    await untilRun(2);
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe("run 2");
  });

  // `bun run` starts the entry point that exports a server.
  test("export default { fd, fetch }", async () => {
    using dir = tempDir("fd-default", {
      "server.ts": `export default { fd: 3, fetch: () => new Response("default export") };`,
    });
    const donor = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = donor.port;
    await using child = Bun.spawn({
      cmd: [bunExe(), "server.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdio: ["ignore", "ignore", "inherit", donor.fd],
    });
    donor.stop(true);
    // The connection waits in the backlog until the child listens.
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe("default export");
  });
});

// In node the number names a descriptor of the cluster primary. Bun does not
// ask the primary yet. The worker must fail, and it must not listen on the
// descriptor that has this number in the worker.
test("node:http listen({ fd }) in a cluster worker emits an error", async () => {
  using dir = tempDir("fd-worker", {
    "primary.cjs": `
      const cluster = require("node:cluster");
      if (cluster.isPrimary) {
        cluster.fork().on("message", message => {
          console.log(JSON.stringify(message));
          process.exit(0);
        });
      } else {
        const server = require("node:http").createServer(() => {});
        server.once("listening", () => process.send({ listening: server.address() }));
        server.once("error", e => process.send({ code: e.code, syscall: e.syscall, listening: server.listening }));
        server.listen({ fd: 0 });
      }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "primary.cjs"],
    cwd: String(dir),
    env: bunEnv,
    stdin: "ignore",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ out: JSON.parse(stdout.trim()), stderr }).toEqual({
    out: { code: "ENOTSUP", syscall: "listen", listening: false },
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test.skipIf(!isWindows)("Bun.serve({ fd }) throws on Windows", () => {
  expect(() => serve({ fd: 3, fetch: () => new Response() } as any)).toThrow(
    expect.objectContaining({ code: "ENOTSUP", syscall: "listen" }),
  );
});
