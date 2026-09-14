// A seccomp filter can refuse recvmmsg(2) and sendmmsg(2) with ENOSYS or EPERM
// and still allow recvmsg(2) and sendmsg(2). Node keeps working under such a
// filter, because libuv receives with recvmsg and sends one datagram with
// sendmsg. Bun must fall back to those too. Without the fallback, a refused
// recvmmsg delivered no datagram and the level-triggered readable poll spun the
// event loop, and a refused sendmmsg failed every send.
//
// Each case runs bun under a launcher that installs a seccomp filter which
// fails those two syscalls with the given errno.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDirWithFiles, tls } from "harness";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const launcherSrc = `
#define _GNU_SOURCE
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

#if defined(__x86_64__)
  #define MY_AUDIT_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
  #define MY_AUDIT_ARCH AUDIT_ARCH_AARCH64
#else
  #define MY_AUDIT_ARCH 0
#endif

/* usage: deny <recvmmsg|sendmmsg|recvmmsg,sendmmsg> <errno> <cmd> [args...] */
int main(int argc, char **argv) {
  if (argc < 4) return 2;
  if (MY_AUDIT_ARCH == 0) return 77; /* unsupported arch, skip */
  unsigned int nr_recv = strstr(argv[1], "recvmmsg") ? __NR_recvmmsg : ~0u;
  unsigned int nr_send = strstr(argv[1], "sendmmsg") ? __NR_sendmmsg : ~0u;
  unsigned int err = (unsigned int)atoi(argv[2]);

  struct sock_filter filter[] = {
    /* arch check */
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, MY_AUDIT_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    /* nr == recvmmsg or nr == sendmmsg -> fail with the requested errno */
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, nr_recv, 1, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, nr_send, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (err & SECCOMP_RET_DATA)),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog prog = {
    .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])),
    .filter = filter,
  };

  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    perror("prctl(PR_SET_NO_NEW_PRIVS)");
    return 77; /* cannot install filter, skip */
  }
  if (syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, 0, &prog) != 0) {
    perror("seccomp");
    return 77; /* cannot install filter, skip */
  }

  execvp(argv[3], &argv[3]);
  perror("execvp");
  return 127;
}
`;

// Linux errno values (identical on x86_64 and aarch64).
const errnos = { ENOSYS: 38, EPERM: 1 };

// Returns the launcher path, or null if the host cannot build it (no cc, no
// kernel headers). Any other compile failure throws so that a broken launcher
// does not turn into a silent skip.
function tryBuildLauncher(): string | null {
  const dir = tempDirWithFiles("udp-mmsg-seccomp", { "deny.c": launcherSrc });
  const bin = join(dir, "deny");
  const compile = spawnSync("cc", ["-O0", "-o", bin, join(dir, "deny.c")], { stdio: "pipe" });
  if ((compile.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
  if (compile.status !== 0) {
    const stderr = compile.stderr?.toString() ?? "";
    if (/linux\/(seccomp|filter|audit)\.h|sys\/prctl\.h/.test(stderr)) return null;
    throw new Error(`failed to compile the seccomp launcher:\n${stderr}`);
  }
  return bin;
}

// Every child prints one line and exits as soon as it knows the outcome: the
// expected traffic arrived, or a socket reported an error.

// node:dgram: three echo round trips. The first exercises the switch from the
// refused syscall to the fallback, the later ones the fallback alone.
const dgramEcho = `
  import dgram from "node:dgram";
  const done = line => { console.log(line); process.exit(0); };
  const server = dgram.createSocket("udp4");
  const client = dgram.createSocket("udp4");
  server.on("error", e => done("server 'error': " + e.code));
  client.on("error", e => done("client 'error': " + e.code));
  server.on("message", (msg, rinfo) =>
    server.send(msg, rinfo.port, rinfo.address, e => e && done("server send callback: " + e.code)),
  );
  const echoes = [];
  const ping = () =>
    client.send("ping" + echoes.length, server.address().port, "127.0.0.1", e => e && done("client send callback: " + e.code));
  client.on("message", msg => {
    echoes.push(String(msg));
    if (echoes.length === 3) done("echoes: " + echoes.join(" "));
    ping();
  });
  server.bind(0, "127.0.0.1", ping);
`;

// Bun.udpSocket: one sendMany() call of 20 datagrams, more than one receive
// batch (LIBUS_UDP_RECV_COUNT is 8), so both fallback loops move several
// datagrams per call.
const sendMany = `
  const done = line => { console.log(line); process.exit(0); };
  const N = 20;
  const received = new Set();
  let sent;
  const server = await Bun.udpSocket({
    hostname: "127.0.0.1",
    socket: {
      data(_socket, data) {
        received.add(String(data));
        if (received.size === N) done("sent " + sent + ", received " + received.size);
      },
      error(_socket, e) { done("server error: " + e.code); },
    },
  });
  const client = await Bun.udpSocket({
    hostname: "127.0.0.1",
    socket: { error(_socket, e) { done("client error: " + e.code); } },
  });
  const packets = [];
  for (let i = 0; i < N; i++) packets.push("datagram " + i, server.port, "127.0.0.1");
  try {
    sent = client.sendMany(packets);
  } catch (e) {
    done("sendMany threw: " + e.code);
  }
`;

// HTTP/3: the QUIC server (JS thread) and the QUIC client (HTTP thread) both
// receive through bsd_recvmmsg and send through their own sendmmsg batch.
const http3 = `
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: ${JSON.stringify(tls)},
    http3: true,
    http1: false,
    fetch: () => new Response("hello over h3"),
  });
  let line;
  try {
    const res = await fetch("https://127.0.0.1:" + server.port + "/", {
      protocol: "http3",
      tls: { rejectUnauthorized: false },
    });
    line = res.status + " " + (await res.text());
  } catch (e) {
    line = "fetch failed: " + e.name;
  }
  console.log(line);
  process.exit(0);
`;

describe.skipIf(!isLinux)("UDP when recvmmsg(2) / sendmmsg(2) are refused", () => {
  const launcher = isLinux ? tryBuildLauncher() : null;

  async function run(deny: string, errno: keyof typeof errnos, script: string) {
    if (launcher == null) {
      // bun:test has no runtime skip. Say so loudly, so that CI output shows
      // that this is not a real pass.
      console.warn("SKIP: cc or the seccomp headers are not available");
      return null;
    }
    await using proc = Bun.spawn({
      cmd: [launcher, deny, String(errnos[errno]), bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode === 77) {
      console.warn("SKIP: this environment does not permit a seccomp filter:", stderr.trim());
      return null;
    }
    // stderr is not asserted: ASAN builds print a startup warning there.
    return { stdout: stdout.trim(), exitCode };
  }

  for (const deny of ["recvmmsg", "sendmmsg", "recvmmsg,sendmmsg"]) {
    for (const errno of ["ENOSYS", "EPERM"] as const) {
      test.concurrent(`node:dgram echoes with ${deny} failing with ${errno}`, async () => {
        const out = await run(deny, errno, dgramEcho);
        if (out == null) return;
        expect(out).toEqual({ stdout: "echoes: ping0 ping1 ping2", exitCode: 0 });
      });
    }
  }

  for (const errno of ["ENOSYS", "EPERM"] as const) {
    test.concurrent(`Bun.udpSocket sendMany() delivers every datagram with both failing with ${errno}`, async () => {
      const out = await run("recvmmsg,sendmmsg", errno, sendMany);
      if (out == null) return;
      expect(out).toEqual({ stdout: "sent 20, received 20", exitCode: 0 });
    });
  }

  test.concurrent("fetch() over HTTP/3 completes with both failing with ENOSYS", async () => {
    const out = await run("recvmmsg,sendmmsg", "ENOSYS", http3);
    if (out == null) return;
    expect(out).toEqual({ stdout: "200 hello over h3", exitCode: 0 });
  });
});
