import { file, serve } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir, tmpdirSync } from "harness";
import { readFileSync } from "node:fs";
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

// A failed listen throws the error of the call that failed. `errno` is the
// negative libuv number that util.getSystemErrorName() takes, as in node.
describe("Bun.serve() reports why the listen failed", () => {
  function shape({ code, syscall, errno, message }: any) {
    return {
      code,
      syscall,
      errno: typeof errno === "number" && errno < 0 ? getSystemErrorName(errno) : errno,
      message,
    };
  }
  function listenError(options: object) {
    try {
      serve({ ...options, fetch: () => new Response() } as any).stop(true);
    } catch (e) {
      return shape(e);
    }
  }

  describe.each([
    ["http", {}],
    ["https", { tls }],
  ] as const)("%s", (_, protocol) => {
    // Winsock answers WSAEACCES, not WSAEADDRINUSE, to some of these binds.
    test.skipIf(!hasIPv4).each([
      ["127.0.0.1", { hostname: "127.0.0.1" }, {}],
      ["every address", {}, {}],
      ["every address with reusePort", {}, { reusePort: true }],
      ["every address in production mode", {}, { development: false }],
    ])("a port that is in use on %s throws EADDRINUSE", (_, address, mode) => {
      using occupant = serve({ ...protocol, ...address, port: 0, fetch: () => new Response() });
      expect(listenError({ ...protocol, ...address, ...mode, port: occupant.port })).toEqual({
        code: "EADDRINUSE",
        syscall: "listen",
        errno: "EADDRINUSE",
        message: `Failed to start server. Is port ${occupant.port} in use?`,
      });
    });

    test("a unix socket in a directory that does not exist throws ENOENT", () => {
      const unix = isWindows ? "C:\\notfound\\listen.sock" : "/notfound/listen.sock";
      expect(listenError({ ...protocol, unix })).toEqual({
        code: "ENOENT",
        syscall: "listen",
        errno: "ENOENT",
        message: `ENOENT: no such file or directory, listen '${unix}'`,
      });
    });
  });

  // 192.0.2.0/24 is TEST-NET-1 (RFC 5737). No interface has such an address,
  // so bind() refuses it, unless Linux is configured to bind non-local addresses.
  const bindsNonLocal =
    isLinux &&
    (() => {
      try {
        return readFileSync("/proc/sys/net/ipv4/ip_nonlocal_bind", "utf8").trim() === "1";
      } catch {
        return false;
      }
    })();
  test.skipIf(!hasIPv4 || bindsNonLocal)("an address that is not on this machine throws EADDRNOTAVAIL", () => {
    expect(listenError({ hostname: "192.0.2.1", port: 0 })).toEqual({
      code: "EADDRNOTAVAIL",
      syscall: "listen",
      errno: "EADDRNOTAVAIL",
      message: "EADDRNOTAVAIL: address not available, listen",
    });
  });

  // An IPv6 literal never reaches the resolver. What an unknown zone does is
  // only known for Linux: getaddrinfo() refuses it.
  test.skipIf(!isLinux).each(["fe80::1%nope0", "[fe80::1%nope0]"])(
    "the IPv6 literal %p with a zone that names no interface throws EINVAL",
    hostname => {
      expect(listenError({ hostname, port: 0 })).toEqual({
        code: "EINVAL",
        syscall: "listen",
        errno: "EINVAL",
        message: "EINVAL: invalid argument, listen",
      });
    },
  );

  // The report in #30363: Bun.serve on 127.0.0.1:80 as a user that may not
  // bind it. The kernel refuses this bind before it looks at who holds the port.
  const isRoot = process.getuid?.() === 0;
  // root may bind any port, so the fixture gives root up.
  const asNobody = isRoot ? { uid: 65534, gid: 65534 } : {};
  const refusesPort80 = (() => {
    // Windows has no privileged ports.
    if (isWindows) return false;
    if (isLinux) {
      // Linux lets every user bind a port at or above this one.
      try {
        if (Number(readFileSync("/proc/sys/net/ipv4/ip_unprivileged_port_start", "utf8")) <= 80) return false;
      } catch {}
    }
    if (!isRoot) return true;
    // The fixture needs a bun that the unprivileged user can execute.
    try {
      return Bun.spawnSync({ cmd: [bunExe(), "--version"], env: bunEnv, ...asNobody }).exitCode === 0;
    } catch {
      return false;
    }
  })();
  test.skipIf(!refusesPort80)("a privileged port throws EACCES", async () => {
    const fixture = /* js */ `
      const { getSystemErrorName } = require("util");
      const shape = ({ code, syscall, errno, message }) => ({ code, syscall, errno: errno < 0 ? getSystemErrorName(errno) : errno, message });
      const out = {};
      try {
        Bun.serve({ hostname: "127.0.0.1", port: 80, fetch: () => new Response() }).stop(true);
        out.serve = "listening";
      } catch (e) {
        out.serve = shape(e);
      }
      const server = require("http").createServer();
      server.on("error", e => {
        out.http = shape(e);
        console.log(JSON.stringify(out));
      });
      server.listen(80, "127.0.0.1", () => {
        out.http = "listening";
        console.log(JSON.stringify(out));
        server.close();
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      ...asNobody,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const denied = {
      code: "EACCES",
      syscall: "listen",
      errno: "EACCES",
      message: "permission denied 127.0.0.1:80",
    };
    expect({ out: JSON.parse(stdout || "null"), stderr }).toEqual({ out: { serve: denied, http: denied }, stderr: "" });
    expect(exitCode).toBe(0);
  });

  // At the descriptor limit socket() fails before there is anything to bind.
  // The unix path is relative: an absolute temporary path can be longer than
  // sun_path, and the long path code opens the directory first.
  test.skipIf(isWindows)("the file descriptor limit throws EMFILE", async () => {
    using dir = tempDir("serve-listen-emfile", {});
    const fixture = /* js */ `
      const fs = require("fs");
      const addresses = { tcp: { hostname: "127.0.0.1", port: 0 }, unix: { unix: "emfile.sock" } };
      if (process.env.HAS_IPV6) addresses.tcp6 = { hostname: "::1", port: 0 };
      // glibc needs a descriptor to look a name up, and reports that through errno.
      if (process.platform === "linux") addresses.localhost = { hostname: "localhost", port: 0 };
      const held = [];
      for (;;) {
        try {
          held.push(fs.openSync("/dev/null", "r"));
        } catch {
          break;
        }
      }
      const errors = {};
      for (const [name, address] of Object.entries(addresses)) {
        try {
          Bun.serve({ ...address, fetch: () => new Response() }).stop(true);
          errors[name] = "listening";
        } catch (e) {
          errors[name] = { code: e.code, syscall: e.syscall, errno: e.errno };
        }
      }
      for (const fd of held) fs.closeSync(fd);
      console.log(JSON.stringify(errors));
    `;
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", 'ulimit -n 256 && exec "$@"', "sh", bunExe(), "-e", fixture],
      env: { ...bunEnv, HAS_IPV6: hasIPv6 ? "1" : "" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const errors = Object.entries(JSON.parse(stdout || "{}")).map(([name, error]) => [
      name,
      typeof error === "string" ? error : shape({ ...(error as object), message: undefined }),
    ]);
    const emfile = { code: "EMFILE", syscall: "listen", errno: "EMFILE", message: undefined };
    expect({ errors: Object.fromEntries(errors), stderr }).toEqual({
      errors: {
        tcp: emfile,
        unix: emfile,
        ...(hasIPv6 ? { tcp6: emfile } : {}),
        ...(isLinux ? { localhost: emfile } : {}),
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });
});
