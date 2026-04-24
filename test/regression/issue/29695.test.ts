// Regression for https://github.com/oven-sh/bun/issues/29695
//
// The internal DNS cache that fetch/Bun.serve outbound/uws uses was always
// reordering getaddrinfo() results so the first entry was IPv6. On hosts where
// IPv6 is configured but a specific destination is unreachable (python.org via
// a VPN, etc.) this made fetch pick a dead AAAA before a reachable A, producing
// ECONNRESET — and it also disagreed with `dns.lookup()` and with the OS's own
// RFC 6724 destination selection.
//
// To drive the bug without touching the machine-wide `/etc/gai.conf` (which
// would leak into every test running in the same shard) the test compiles a
// tiny `LD_PRELOAD` shim that intercepts only one hostname: `mock29695`
// resolves to `[127.0.0.1, ::1]` in that exact order, everything else falls
// through to glibc. The shim lives in tempDir() and is scoped to the single
// Bun.spawn subprocess that runs the actual fetch. Only runs on glibc Linux
// with `cc` available and an IPv6 loopback — macOS uses libinfo so
// LD_PRELOAD doesn't reach the same code path, musl's loader ignores
// LD_PRELOAD for setuid binaries and has its own getaddrinfo, and we need
// ::1 for the dual-stack listener to actually bind.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { bunEnv, bunExe, isGlibc, isLinux, tempDirWithFiles } from "harness";
import { join } from "node:path";
import { which } from "bun";

const CC = which("cc") ?? which("gcc");

const canRun =
  isLinux &&
  isGlibc &&
  CC !== null &&
  // Need ::1 loopback so the dual-stack server's AAAA listener actually comes up.
  existsSync("/proc/net/if_inet6") &&
  readFileSync("/proc/net/if_inet6", "utf8")
    .split("\n")
    .some(line => line.startsWith("00000000000000000000000000000001"));

// A libc `getaddrinfo`/`freeaddrinfo` shim: for the host `mock29695` it
// returns a two-element linked list [127.0.0.1, ::1] in that exact order,
// packed into a single allocation so `freeaddrinfo` can be a single free().
// Everything else is forwarded to the real implementations via dlsym.
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <netdb.h>
#include <netinet/in.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>

#define MOCK_HOST "mock29695"
#define MOCK_MAGIC 0xBEEFCAFE12345678ULL

struct mock_bundle {
    unsigned long long magic;
    struct addrinfo a4;
    struct addrinfo a6;
    struct sockaddr_in sa4;
    struct sockaddr_in6 sa6;
};

int getaddrinfo(const char *node, const char *service,
                const struct addrinfo *hints, struct addrinfo **res) {
    if (node && strcmp(node, MOCK_HOST) == 0) {
        unsigned short port = service ? (unsigned short)atoi(service) : 0;
        struct mock_bundle *b = calloc(1, sizeof(*b));
        if (!b) return EAI_MEMORY;
        b->magic = MOCK_MAGIC;

        b->sa4.sin_family = AF_INET;
        b->sa4.sin_port = htons(port);
        b->sa4.sin_addr.s_addr = htonl(0x7F000001); /* 127.0.0.1 */

        b->sa6.sin6_family = AF_INET6;
        b->sa6.sin6_port = htons(port);
        b->sa6.sin6_addr.s6_addr[15] = 1; /* ::1 */

        int socktype = (hints && hints->ai_socktype) ? hints->ai_socktype : SOCK_STREAM;

        b->a4.ai_family = AF_INET;
        b->a4.ai_socktype = socktype;
        b->a4.ai_addrlen = sizeof(b->sa4);
        b->a4.ai_addr = (struct sockaddr *)&b->sa4;
        b->a4.ai_next = &b->a6;

        b->a6.ai_family = AF_INET6;
        b->a6.ai_socktype = socktype;
        b->a6.ai_addrlen = sizeof(b->sa6);
        b->a6.ai_addr = (struct sockaddr *)&b->sa6;

        *res = &b->a4;
        return 0;
    }

    int (*real)(const char*, const char*, const struct addrinfo*, struct addrinfo**) =
        dlsym(RTLD_NEXT, "getaddrinfo");
    return real(node, service, hints, res);
}

void freeaddrinfo(struct addrinfo *res) {
    if (res) {
        /* Recover the bundle head: .a4 lives at offsetof(mock_bundle, a4)
         * inside the bundle, so subtracting that from res gets us back to
         * the magic word. */
        char *p = (char *)res - offsetof(struct mock_bundle, a4);
        struct mock_bundle *b = (struct mock_bundle *)p;
        if (b->magic == MOCK_MAGIC) {
            free(b);
            return;
        }
    }
    void (*real)(struct addrinfo *) = dlsym(RTLD_NEXT, "freeaddrinfo");
    real(res);
}
`;

test.skipIf(!canRun)(
  "fetch() respects OS getaddrinfo() ordering instead of forcing IPv6 first",
  async () => {
    // Compile the shim into the test's tempDir so the .so is torn down with
    // the directory and never pollutes a shared location.
    const dir = tempDirWithFiles("issue-29695", { "shim.c": SHIM_C });
    const shimSo = join(dir, "shim.so");
    await using cc = Bun.spawn({
      cmd: [CC!, "-shared", "-fPIC", "-ldl", "-o", shimSo, join(dir, "shim.c")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [ccStdout, ccStderr, ccExit] = await Promise.all([cc.stdout.text(), cc.stderr.text(), cc.exited]);
    // If the compile failed the exitCode assertion below will surface the
    // full diagnostic through the ccStderr value. The printed object keeps
    // that message in scope for the failure message.
    expect({ ccStdout, ccStderr, ccExit }).toMatchObject({ ccExit: 0 });

    // Run the fetch in a fresh subprocess so LD_PRELOAD / the feature flag
    // are isolated. `Bun.serve({ hostname: "::" })` listens on a dual-stack
    // socket, so an IPv4 connection shows up as `::ffff:127.0.0.1` and a
    // native IPv6 connection shows up as `::1` — a one-bit signal for which
    // family the internal DNS cache picked.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* ts */ `
          using server = Bun.serve({
            hostname: "::",
            port: 0,
            fetch(req, srv) {
              return Response.json(srv.requestIP(req));
            },
          });
          const body = await fetch(\`http://mock29695:\${server.port}/\`, { keepalive: false }).then(r => r.json());
          console.log(JSON.stringify(body));
        `,
      ],
      env: {
        ...bunEnv,
        LD_PRELOAD: shimSo,
        // DISABLE_ADDRCONFIG bypasses AI_ADDRCONFIG in the uws DNS path so the
        // shim's AAAA record isn't filtered out on containers whose only IPv6
        // route is loopback.
        BUN_FEATURE_FLAG_DISABLE_ADDRCONFIG: "1",
        // Egress proxy in some CI sandboxes refuses to forward arbitrary
        // hostnames; keep the mock hostname local.
        NO_PROXY: "mock29695,localhost,127.0.0.1,::1",
        no_proxy: "mock29695,localhost,127.0.0.1,::1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Parse the one JSON line the child printed.
    const body = JSON.parse(stdout.trim().split("\n").at(-1)!);

    // With the shim, getaddrinfo() returns [127.0.0.1, ::1] in that order.
    // After the fix, the internal DNS cache preserves that order and the
    // dual-stack server sees the IPv4-mapped address. Before the fix, the
    // cache forced AAAA to the front and the server saw pure ::1.
    expect(body).toMatchObject({ address: "::ffff:127.0.0.1", family: "IPv6" });
    expect(exitCode).toBe(0);
  },
);
