import { file, serve } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tmpdirSync } from "harness";
import { writeFileSync } from "node:fs";
import type { NetworkInterfaceInfo } from "node:os";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

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

// listen(port, "localhost") walks the getaddrinfo() results in resolver order
// and binds the first one, as node does. It moves to the next address only when
// bind() says the address cannot be bound on this host (EADDRNOTAVAIL,
// EAFNOSUPPORT). The wildcard (no hostname) keeps its fallback on any error.
describe('listen on "localhost"', () => {
  test("Bun.serve() reports EADDRINUSE instead of binding the other loopback family", () => {
    using first = serve({ hostname: "localhost", port: 0, fetch: () => new Response() });
    let error: any;
    try {
      serve({ hostname: "localhost", port: first.port, fetch: () => new Response() }).stop(true);
    } catch (e) {
      error = e;
    }
    expect({ code: error?.code, syscall: error?.syscall }).toEqual({ code: "EADDRINUSE", syscall: "listen" });
  });

  test("Bun.listen() reports EADDRINUSE instead of binding the other loopback family", () => {
    using first = Bun.listen({ hostname: "localhost", port: 0, socket: { data() {} } });
    let error: any;
    try {
      Bun.listen({ hostname: "localhost", port: first.port, socket: { data() {} } }).stop(true);
    } catch (e) {
      error = e;
    }
    expect({ code: error?.code, syscall: error?.syscall }).toEqual({ code: "EADDRINUSE", syscall: "listen" });
  });

  // Linux refuses bind(::) while a listener holds [::1]:port. The wildcard
  // listener then falls back to 0.0.0.0, as before this change.
  test.skipIf(!isLinux || !hasIPv6)(
    "Bun.serve() with no hostname falls back to 0.0.0.0 when only [::1]:port is taken",
    () => {
      using occupant = Bun.listen({ hostname: "::1", port: 0, socket: { data() {} } });
      using server = serve({ port: occupant.port, fetch: () => new Response() });
      expect(server.address).toMatchObject({ address: "0.0.0.0", port: occupant.port });
    },
  );

  // Every listener in the process reports the loopback address it bound.
  const probe = /* js */ `
    import net from "node:net";
    import dns from "node:dns/promises";
    const out = {};
    out.lookup = (await dns.lookup("localhost", { all: true, order: "verbatim" })).map(a => a.address);
    const server = Bun.serve({ hostname: "localhost", port: 0, fetch: () => new Response("ok") });
    out.serve = server.address.address;
    out.fetch = (await fetch("http://" + (out.serve.includes(":") ? "[" + out.serve + "]" : out.serve) + ":" + server.port + "/")).status;
    server.stop(true);
    const listener = Bun.listen({ hostname: "localhost", port: 0, socket: { data() {} } });
    out.listen = await new Promise(resolve => {
      const c = net.connect(listener.port, out.serve, () => { c.destroy(); resolve(out.serve); });
      c.on("error", e => resolve(e.code));
    });
    listener.stop(true);
    const netServer = net.createServer();
    await new Promise(resolve => netServer.listen(0, "localhost", resolve));
    out.net = netServer.address().address;
    netServer.close();
    const udp = await Bun.udpSocket({ hostname: "localhost", port: 0 });
    out.udp = udp.address.address;
    udp.close();
    console.log(JSON.stringify(out));
  `;

  async function runProbe(wrap: string[]) {
    await using proc = Bun.spawn({
      cmd: [...wrap, bunExe(), "-e", probe],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout.trim());
  }

  function expectBound(out: Record<string, unknown>, address: string) {
    expect(out).toMatchObject({ serve: address, fetch: 200, listen: address, net: address, udp: address });
  }

  // The resolver's first answer is the address the listeners bind, on every
  // platform. dns.lookup() uses the same resolver as the listen path.
  test("every listener binds the first address dns.lookup reports", async () => {
    const out = await runProbe([]);
    expectBound(out, out.lookup[0]);
  });

  // A private mount namespace lets the test swap /etc/gai.conf, which is how
  // glibc orders getaddrinfo() results. Skipped where user namespaces are off,
  // as in most containers, and where the resolver is not glibc.
  const gaiConf = join(tmpdirSync(), "gai.conf");
  writeFileSync(gaiConf, "precedence ::ffff:0:0/96  100\n");
  const canSwapResolverOrder =
    isLinux &&
    Bun.which("unshare") !== null &&
    Bun.spawnSync({
      cmd: ["unshare", "-Urm", "sh", "-c", 'mount --bind "$0" /etc/gai.conf && getent ahosts localhost', gaiConf],
      stderr: "ignore",
    })
      .stdout.toString()
      .startsWith("127.0.0.1");

  test.skipIf(!canSwapResolverOrder)("every listener binds 127.0.0.1 when the resolver puts it first", async () => {
    const out = await runProbe([
      "unshare",
      "-Urm",
      "sh",
      "-c",
      'mount --bind "$0" /etc/gai.conf && exec "$@"',
      gaiConf,
    ]);
    expect(out.lookup[0]).toBe("127.0.0.1");
    expectBound(out, "127.0.0.1");
  });

  // A private network namespace with IPv6 turned off on lo: bind(::1) fails
  // with EADDRNOTAVAIL and every listener falls back to 127.0.0.1.
  const canDisableIPv6 =
    isLinux &&
    Bun.which("unshare") !== null &&
    Bun.spawnSync({
      cmd: ["unshare", "-Urn", "sh", "-c", "ip link set lo up && sysctl -qw net.ipv6.conf.lo.disable_ipv6=1"],
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0;

  test.skipIf(!canDisableIPv6)("every listener falls back to 127.0.0.1 when IPv6 is disabled on lo", async () => {
    const out = await runProbe([
      "unshare",
      "-Urn",
      "sh",
      "-c",
      'ip link set lo up && sysctl -qw net.ipv6.conf.lo.disable_ipv6=1 && exec "$@"',
      "sh",
    ]);
    expectBound(out, "127.0.0.1");
  });
});
