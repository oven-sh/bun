import { file, serve } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir, tmpdirSync } from "harness";
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

// glibc's getaddrinfo runs an RFC 3484 source-address probe (a UDP connect()
// per candidate) whenever it has more than one result to sort; under
// ephemeral-port or routing-cache pressure that connect() can fail EAGAIN and
// glibc's own IN6_IS_ADDR_V4MAPPED assertion abort()s the whole process. The
// listen path passes NULL or a numeric IP in every common configuration and
// never needs the resolver, so it should bypass getaddrinfo entirely. The
// LD_PRELOAD shim below turns any AI_PASSIVE getaddrinfo into the same abort
// so the gate can prove the bypass without kernel-level fault injection.
describe("listen avoids main-thread getaddrinfo for wildcard and numeric-IP hosts", () => {
  const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
  const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <netdb.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <unistd.h>

static int (*real_getaddrinfo)(const char *, const char *, const struct addrinfo *, struct addrinfo **);

int getaddrinfo(const char *node, const char *service,
                const struct addrinfo *hints, struct addrinfo **res) {
  if (!real_getaddrinfo)
    real_getaddrinfo = (int (*)(const char *, const char *, const struct addrinfo *, struct addrinfo **))
        dlsym(RTLD_NEXT, "getaddrinfo");
  if (hints && (hints->ai_flags & AI_PASSIVE) && hints->ai_family == AF_UNSPEC) {
    fprintf(stderr,
            "Fatal glibc error: ../sysdeps/posix/getaddrinfo.c:2547 (getaddrinfo): "
            "assertion failed: IN6_IS_ADDR_V4MAPPED (sin6->sin6_addr.s6_addr32)\\n");
    abort();
  }
  return real_getaddrinfo(node, service, hints, res);
}
`;

  let dir: ReturnType<typeof tempDir> | undefined;
  let shimPath: string;

  beforeAll(async () => {
    if (!isLinux || !cc) return;
    dir = tempDir("listen-gai-abort", {
      "shim.c": SHIM_C,
      "serve.ts": `
        using srv = Bun.serve({ port: 0, ...(process.argv[2] ? { hostname: process.argv[2] } : {}), fetch: () => new Response("ok") });
        const r = await fetch(\`http://\${process.argv[2]?.includes(":") ? "[::1]" : "127.0.0.1"}:\${srv.port}/\`);
        console.log("fetch:", await r.text());
        console.log("DONE", srv.port);
      `,
      "listen.ts": `
        using srv = Bun.listen({ port: 0, hostname: process.argv[2], socket: { data() {} } });
        console.log("DONE", srv.port);
      `,
      "udp.ts": `
        const s = await Bun.udpSocket({ port: 0, ...(process.argv[2] ? { hostname: process.argv[2] } : {}) });
        console.log("DONE", s.port, s.address.family);
        s.close();
      `,
    });
    shimPath = join(String(dir), "shim.so");
    await using ccProc = Bun.spawn({
      cmd: [cc, "-shared", "-fPIC", "-o", shimPath, join(String(dir), "shim.c"), "-ldl"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
    if (ccExit !== 0) throw new Error(`shim compile failed: ${ccErr || ccOut}`);
  });

  afterAll(() => {
    dir?.[Symbol.dispose]();
  });

  async function runUnderShim(fixture: string, hostname: string | undefined) {
    const existing = bunEnv.LD_PRELOAD;
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, ...(hostname !== undefined ? [hostname] : [])],
      cwd: String(dir),
      env: { ...bunEnv, LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }

  test.concurrent.skipIf(!isLinux || !cc).each([
    ["Bun.serve default", "serve.ts", undefined],
    ["Bun.serve 0.0.0.0", "serve.ts", "0.0.0.0"],
    ["Bun.serve 127.0.0.1", "serve.ts", "127.0.0.1"],
    ["Bun.serve ::", "serve.ts", "::"],
    ["Bun.listen 0.0.0.0", "listen.ts", "0.0.0.0"],
    ["Bun.listen 127.0.0.1", "listen.ts", "127.0.0.1"],
    ["Bun.listen ::1", "listen.ts", "::1"],
    ["Bun.udpSocket default", "udp.ts", undefined],
    ["Bun.udpSocket 127.0.0.1", "udp.ts", "127.0.0.1"],
    ["Bun.udpSocket ::", "udp.ts", "::"],
  ] as const)("%s binds without getaddrinfo", async (_label, fixture, hostname) => {
    const { stdout, stderr, exitCode, signalCode } = await runUnderShim(fixture, hostname);
    // One combined assertion so a SIGABRT surfaces stderr + exit in the diff.
    expect({
      done: stdout.includes("DONE "),
      stdout,
      stderr,
      exitCode,
      signalCode,
    }).toEqual({
      done: true,
      stdout: expect.any(String),
      stderr: expect.not.stringContaining("Fatal glibc error"),
      exitCode: 0,
      signalCode: null,
    });
  });
});
