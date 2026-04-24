// Regression for https://github.com/oven-sh/bun/issues/29695
//
// The internal DNS cache that fetch/Bun.serve outbound/uws uses was always
// reordering getaddrinfo() results so the first entry was IPv6. On hosts where
// IPv6 is configured but a specific destination is unreachable (python.org via
// a VPN, etc.) this made fetch pick a dead AAAA before a reachable A, producing
// ECONNRESET — and it also disagreed with `dns.lookup()` and with the OS's own
// RFC 6724 destination selection.
//
// This test drives the bug via a custom `/etc/gai.conf` that asks glibc to
// prefer IPv4 and then checks that the uws connect path honors that order.
// It only runs on glibc Linux as root (the only environment that can rewrite
// gai.conf and has getaddrinfo() read it) — macOS uses libinfo and has no
// gai.conf, musl has no gai.conf, and containers without root can't make
// the syscall observe a different order.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { bunEnv, bunExe, isGlibc, isLinux } from "harness";

const GAI_CONF_PATH = "/etc/gai.conf";
const GAI_CONF_BACKUP = "/etc/gai.conf.bun-29695.bak";

// Prefer IPv4 over IPv6 at the destination-selection step. This flips the
// order glibc returns from getaddrinfo("localhost") so the list is
// [127.0.0.1, ::1] instead of the usual [::1, 127.0.0.1] — giving us a
// deterministic signal that the uws DNS path respected OS order rather
// than forcing AAAA first.
const GAI_CONF_PREFER_IPV4 = `# Temporary override written by test/regression/issue/29695.test.ts.
label  ::1/128       0
label  ::/0          1
label  2002::/16     2
label  ::/96         3
label  ::ffff:0:0/96 4
label  fec0::/10     5
label  fc00::/7      6
label  2001:0::/32   7

precedence  ::1/128       50
precedence  ::/0          40
precedence  2002::/16     30
precedence  ::/96         20
precedence  ::ffff:0:0/96 100
`;

const canRun =
  isLinux &&
  isGlibc &&
  process.getuid?.() === 0 &&
  // Need ::1 loopback so we have an AAAA record to race against 127.0.0.1.
  existsSync("/proc/net/if_inet6") &&
  readFileSync("/proc/net/if_inet6", "utf8").split("\n").some(line => line.startsWith("00000000000000000000000000000001"));

let savedBackup = false;

function restoreGaiConf() {
  try {
    unlinkSync(GAI_CONF_PATH);
  } catch {}
  if (savedBackup) {
    try {
      renameSync(GAI_CONF_BACKUP, GAI_CONF_PATH);
    } catch {}
    savedBackup = false;
  }
}

beforeAll(() => {
  if (!canRun) return;

  if (existsSync(GAI_CONF_PATH)) {
    renameSync(GAI_CONF_PATH, GAI_CONF_BACKUP);
    savedBackup = true;
  }
  writeFileSync(GAI_CONF_PATH, GAI_CONF_PREFER_IPV4);

  // Belt-and-suspenders: even if the test runner crashes between
  // beforeAll and afterAll, don't leave a modified /etc/gai.conf that
  // bleeds into unrelated tests.
  process.once("exit", restoreGaiConf);
});

afterAll(() => {
  if (!canRun) return;
  restoreGaiConf();
});

test.skipIf(!canRun)(
  "fetch() respects OS getaddrinfo() ordering instead of forcing IPv6 first",
  async () => {
    // Run the fetch in a fresh subprocess: the DISABLE_ADDRCONFIG feature
    // flag is sampled and cached on first use by the env_var layer, so it
    // has to be set before any DNS lookup happens.
    //
    // `Bun.serve({ hostname: "::" })` listens on a dual-stack socket, so an
    // incoming IPv4 connection shows up as the IPv4-mapped address
    // `::ffff:127.0.0.1` and a native IPv6 connection shows up as `::1`.
    // That gives us a one-bit signal for "which family did fetch pick?".
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
          const body = await fetch(\`http://localhost:\${server.port}/\`, { keepalive: false }).then(r => r.json());
          console.log(JSON.stringify(body));
        `,
      ],
      env: {
        ...bunEnv,
        BUN_FEATURE_FLAG_DISABLE_ADDRCONFIG: "1",
        // The farm proxy otherwise refuses to forward arbitrary hostnames;
        // make sure localhost stays direct in both upper- and lowercase.
        NO_PROXY: "localhost,127.0.0.1,::1",
        no_proxy: "localhost,127.0.0.1,::1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });

    // Parse the only JSON object the child printed.
    const body = JSON.parse(stdout.trim().split("\n").at(-1)!);

    // With the gai.conf override, OS order is [127.0.0.1, ::1]. After the
    // fix, the internal DNS cache preserves that order and the dual-stack
    // server sees the IPv4-mapped address. Before the fix, the cache
    // forced AAAA to the front and the server saw pure ::1.
    expect(body).toMatchObject({ address: "::ffff:127.0.0.1", family: "IPv6" });
  },
);
