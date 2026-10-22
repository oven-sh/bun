import { file, serve } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir, tmpdirSync } from "harness";
import { closeSync, openSync, readFileSync } from "node:fs";
import type { NetworkInterfaceInfo } from "node:os";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { getSystemErrorName } from "node:util";

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
          // "C:" is the URL's host, where a raw ":" would start a port.
          hostname: unix.substring(0, unix.indexOf(":")) + "%3A",
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
      const { name, code, errno, syscall, hostname: errHostname, message } = error ?? {};
      expect({ name, code, errno, syscall, hostname: errHostname, message }).toEqual({
        name: "Error",
        code: "ENOTFOUND",
        errno: -3008,
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

describe("Bun.serve() throws the error of the call that failed", () => {
  // `errno` is the negative libuv number, as in Node.
  const shape = ({ code, syscall, errno, message }: any) => ({
    code,
    syscall,
    errno: errno < 0 ? getSystemErrorName(errno) : errno,
    message,
  });

  test.skipIf(!hasIPv4).each([
    ["127.0.0.1", { hostname: "127.0.0.1" }],
    ["every address", {}],
  ])("EADDRINUSE for a port that is in use on %s", (_, address) => {
    using occupant = serve({ ...address, port: 0, fetch: () => new Response() });
    let error: unknown;
    try {
      serve({ ...address, port: occupant.port, fetch: () => new Response() }).stop(true);
    } catch (e) {
      error = shape(e);
    }
    expect(error).toEqual({
      code: "EADDRINUSE",
      syscall: "listen",
      errno: "EADDRINUSE",
      message: `Failed to start server. Is port ${occupant.port} in use?`,
    });
  });

  // https://github.com/oven-sh/bun/issues/30363
  const isRoot = process.getuid?.() === 0;
  // root can bind any port, so the child drops to nobody.
  const asNobody = isRoot ? { uid: 65534, gid: 65534 } : {};
  const refusesPort80 = (() => {
    if (isWindows) return false;
    if (isLinux) {
      try {
        if (Number(readFileSync("/proc/sys/net/ipv4/ip_unprivileged_port_start", "utf8")) <= 80) return false;
      } catch {}
    }
    if (!isRoot) return true;
    try {
      return Bun.spawnSync({ cmd: [bunExe(), "--version"], env: bunEnv, ...asNobody }).exitCode === 0;
    } catch {
      return false;
    }
  })();
  test.skipIf(!refusesPort80)("EACCES for a privileged port", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `try {
          Bun.serve({ hostname: "127.0.0.1", port: 80, fetch: () => new Response() }).stop(true);
          console.log("listening");
        } catch ({ code, syscall, errno, message }) {
          console.log(JSON.stringify({ code, syscall, errno, message }));
        }`,
      ],
      env: bunEnv,
      ...asNobody,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(shape(JSON.parse(stdout))).toEqual({
      code: "EACCES",
      syscall: "listen",
      errno: "EACCES",
      message: "permission denied 127.0.0.1:80",
    });
    expect(exitCode).toBe(0);
  });

  const facts = (listen: () => { stop(closeActiveConnections: boolean): unknown }) => {
    try {
      listen().stop(true);
      return "listening";
    } catch ({ code, errno, syscall, address, port, path }: any) {
      return { code, errno: getSystemErrorName(errno), syscall, address, port, path };
    }
  };

  test.skipIf(isWindows || !hasIPv4)("with the properties Bun.listen() gives the same failure", () => {
    using dir = tempDir("serve-listen-error", {});
    using occupant = serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const missing = join(String(dir), "missing", "a.sock");
    const tooLong = join(String(dir), Buffer.alloc(200, "a").toString() + ".sock");
    const rows = [
      [
        { hostname: "127.0.0.1", port: occupant.port },
        { code: "EADDRINUSE", address: "127.0.0.1", port: occupant.port },
      ],
      [{ unix: missing }, { code: "ENOENT", address: missing, path: missing }],
      [{ unix: tooLong }, { code: "ENAMETOOLONG", address: tooLong, path: tooLong }],
    ] as const;
    for (const [address, { code, ...rest }] of rows) {
      const expected = { port: undefined, path: undefined, ...rest, code, errno: code, syscall: "listen" };
      expect(facts(() => serve({ ...address, fetch: () => new Response() }))).toEqual(expected);
      expect(facts(() => Bun.listen({ ...address, socket: { data() {} } }))).toEqual(expected);
    }
  });

  test.skipIf(isWindows)("Bun.listen({ fd }) reports the code listen() failed with", () => {
    using dir = tempDir("serve-listen-fd", { "file.txt": "" });
    const fd = openSync(join(String(dir), "file.txt"), "r");
    const listen = () => Bun.listen({ fd, socket: { data() {} } });
    const expected = { syscall: "listen", address: undefined, port: undefined, path: undefined };
    expect(facts(listen)).toEqual({ ...expected, code: "ENOTSOCK", errno: "ENOTSOCK" });
    closeSync(fd);
    expect(facts(listen)).toEqual({ ...expected, code: "EBADF", errno: "EBADF" });
  });
});
