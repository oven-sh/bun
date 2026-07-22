import { file, serve } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tmpdirSync } from "harness";
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
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

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
