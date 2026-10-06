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
  function listenError(options: { hostname: string; port: number }) {
    try {
      serve({ ...options, fetch: () => new Response() }).stop(true);
    } catch (e: any) {
      const { code, syscall, errno, message } = e;
      return { code, syscall, errno: typeof errno === "number" && errno < 0 ? getSystemErrorName(errno) : errno, message };
    }
  }

  test.skipIf(!hasIPv4)("a port that is in use throws EADDRINUSE", () => {
    using occupant = serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    expect(listenError({ hostname: "127.0.0.1", port: occupant.port! })).toEqual({
      code: "EADDRINUSE",
      syscall: "listen",
      errno: "EADDRINUSE",
      message: `Failed to start server. Is port ${occupant.port} in use?`,
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

  // At the descriptor limit socket() fails before there is anything to bind.
  test.skipIf(isWindows)("the file descriptor limit throws EMFILE", async () => {
    using dir = tempDir("serve-listen-emfile", {});
    const fixture = /* js */ `
      const fs = require("fs");
      const held = [];
      for (;;) {
        try {
          held.push(fs.openSync("/dev/null", "r"));
        } catch {
          break;
        }
      }
      const errors = {};
      const addresses = { tcp: { hostname: "127.0.0.1", port: 0 }, unix: { unix: process.env.SOCKET_PATH } };
      for (const [name, address] of Object.entries(addresses)) {
        try {
          Bun.serve({ ...address, fetch: () => new Response() }).stop(true);
          errors[name] = "listening";
        } catch (e) {
          errors[name] = { code: e.code, syscall: e.syscall };
        }
      }
      for (const fd of held) fs.closeSync(fd);
      console.log(JSON.stringify(errors));
    `;
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", 'ulimit -n 256 && exec "$@"', "sh", bunExe(), "-e", fixture],
      env: { ...bunEnv, SOCKET_PATH: join(String(dir), "emfile.sock") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({
      stdout: JSON.stringify({
        tcp: { code: "EMFILE", syscall: "listen" },
        unix: { code: "EMFILE", syscall: "listen" },
      }),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });
});
