/**
 * HTTP/3 fetch under injected UDP send faults. Exercises lsquic's
 * packets_out short-return path, which is otherwise only reachable when the
 * UDP send buffer is genuinely full or an ICMP from a dead peer is queued on
 * the shared socket.
 *
 * The first case pins the lsquic send_batch requeue-underflow patch: lsquic
 * coalesces the client's INIT-ACK, HSK CRYPTO (TLS Finished) and a SHORT
 * packet into one datagram with pack_off[0]==0 and iovlen>1. If packets_out
 * returns 0 for that spec, the unpatched requeue loop computed
 * &batch->packets[off - 1] with unsigned off and only returned the last
 * packet of the group to the connection; the Finished was silently dropped
 * and the server could never complete the handshake.
 */
import { socketFaultInjection as fault, type SocketFaultRule } from "bun:internal-for-testing";
import { afterEach, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir, tls } from "harness";
import { constants } from "node:os";
import { join } from "node:path";

const skip = !fault.available() || isWindows;

// clear() throws on a build without fault injection, and one test below runs on every build.
if (fault.available()) afterEach(() => fault.clear());

/** CPU time a child process used while it waited, next to how long it waited. */
type CpuReport = { cpuMs: number; wallMs: number };

/**
 * Runs `fn` against an HTTP/3 server in a child process. `serverFault` is armed
 * in the server process: at startup when `armAt` is "listen", otherwise when a
 * request for `/arm-server-fault` arrives, before its response goes out.
 * Resolves to the server's stdout: a JSON `CpuReport` that covers the time from
 * the moment the rule was armed until `fn` settled.
 */
async function withServer(
  fn: (port: number) => Promise<void>,
  serverFault?: SocketFaultRule,
  armAt: "listen" | "request" = "request",
): Promise<string> {
  using dir = tempDir("h3-fault", {
    "server.mjs": `
      import { socketFaultInjection as fault } from "bun:internal-for-testing";
      const rule = process.argv[2] ? JSON.parse(process.argv[2]) : null;
      let armed;
      const arm = () => {
        fault.set(rule);
        armed = { cpu: process.cpuUsage(), at: performance.now() };
      };
      const server = Bun.serve({
        port: 0, hostname: "127.0.0.1",
        ...${JSON.stringify({ tls, http3: true, http1: false })},
        fetch(req) {
          if (rule && new URL(req.url).pathname === "/arm-server-fault") arm();
          return new Response("ok");
        },
      });
      if (rule && process.argv[3] === "listen") arm();
      console.error("PORT=" + server.port);
      process.stdin.on("end", () => {
        if (armed) {
          const { user, system } = process.cpuUsage(armed.cpu);
          console.log(JSON.stringify({ cpuMs: (user + system) / 1000, wallMs: performance.now() - armed.at }));
          fault.clear();
        }
        server.stop(true);
        setTimeout(() => process.exit(0), 50);
      });
      process.stdin.resume();
    `,
  });
  const proc = Bun.spawn({
    cmd: [bunExe(), "server.mjs", ...(serverFault ? [JSON.stringify(serverFault), armAt] : [])],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  let port = 0;
  let buf = "";
  for await (const chunk of proc.stderr) {
    buf += new TextDecoder().decode(chunk);
    const m = buf.match(/PORT=(\d+)/);
    if (m) {
      port = Number(m[1]);
      break;
    }
    if (buf.length > 4096) break;
  }
  if (!port) {
    proc.kill();
    await proc.exited;
    throw new Error("server did not report a port:\n" + buf);
  }
  try {
    await fn(port);
  } finally {
    proc.stdin?.end();
    const killTimer = setTimeout(() => proc.kill(), 500);
    try {
      await proc.exited;
    } finally {
      clearTimeout(killTimer);
    }
  }
  return await proc.stdout.text();
}

const h3 = (port: number, init: RequestInit = {}, path = "/") =>
  fetch(`https://127.0.0.1:${port}${path}`, {
    signal: AbortSignal.timeout(8000),
    ...init,
    protocol: "http3",
    tls: { rejectUnauthorized: false },
  } as RequestInit);

test.skipIf(skip)("EAGAIN on the coalesced handshake datagram is requeued and the fetch completes", async () => {
  await withServer(async port => {
    // Arm an EAGAIN on the second UDP send the client engine makes. The
    // first is the padded Initial (CRYPTO ClientHello). The second is the
    // response to the server's flight: an INIT ACK coalesced with the HSK
    // CRYPTO (Finished) and a SHORT NEW_CONNECTION_ID, i.e. the
    // pack_off[0]==0, iovlen>1 spec whose requeue the patch fixes. The
    // retry-once in us_quic_packets_out is gated on non-EAGAIN, so EAGAIN
    // reaches lsquic as a genuine 0-of-N return.
    fault.set({ syscall: "sendmsg", action: "errno", errno: "EAGAIN", after: 1, repeat: 1 });

    const res = await h3(port);
    expect(await res.text()).toBe("ok");
    expect(res.status).toBe(200);
  });
});

test.skipIf(skip)(
  "a non-backpressure send error on the first datagram recovers without stalling the engine",
  async () => {
    await withServer(async port => {
      // ECONNREFUSED on the very first send is what a stale ICMP on the shared
      // client socket looks like. The failed call consumes the error, so the
      // one immediate retry in us_quic_packets_out sends the datagram.
      fault.set({ syscall: "sendmsg", action: "errno", errno: "ECONNREFUSED", after: 0, repeat: 1 });

      const res = await h3(port);
      expect(await res.text()).toBe("ok");
      expect(res.status).toBe(200);
    });
  },
);

test.skipIf(skip)(
  "repeated EAGAIN over several loop iterations recovers via on_drain without stalling the fetch",
  async () => {
    await withServer(async port => {
      // Fail the first handful of sends with EAGAIN. Each failure re-arms the
      // UDP poll's writable interest; on_drain → send_unsent_packets runs on
      // the next iteration, so progress resumes as soon as the rule disarms.
      // The 8s abort is well above lsquic's one-second resume_sending_at
      // failsafe, so the only way to time out is an engine-level stall.
      fault.set({ syscall: "sendmsg", action: "errno", errno: "EAGAIN", after: 0, repeat: 5 });

      const res = await h3(port);
      expect(await res.text()).toBe("ok");
      expect(res.status).toBe(200);
    });
  },
);

// A send error that is not backpressure and does not go away: the datagram is
// dropped like a packet lost on the wire, and lsquic's loss timer paces the
// retries. Reported to lsquic as EAGAIN instead, the engine waits for the UDP
// socket to be writable, which it already is, and the event loop spins.

// Not on Windows: its dual-stack socket sends this datagram.
test.skipIf(isWindows)(
  "a datagram the kernel refuses to send is dropped without spinning the HTTP thread",
  async () => {
    // No fault injection here, so this runs on release builds too. sendmsg() to
    // the limited broadcast address fails at once and every time on a socket
    // without SO_BROADCAST (EACCES, or ENETUNREACH with no default route). As an
    // IP literal it skips DNS and the connect-time route probe, so packets_out
    // is the first to see the error.
    const client = `
      await using server = Bun.serve({
        port: 0, hostname: "127.0.0.1",
        ...${JSON.stringify({ tls, http3: true, http1: false })},
        fetch: () => new Response("ok"),
      });
      const h3 = (url, ms) =>
        fetch(url, { protocol: "http3", tls: { rejectUnauthorized: false }, signal: AbortSignal.timeout(ms) });
      // One request that works, so that starting the HTTP thread and the QUIC
      // engine is not part of the measurement.
      const warmup = await (await h3("https://127.0.0.1:" + server.port + "/", 8000)).text();
      const cpu = process.cpuUsage(), start = performance.now();
      const outcome = await h3("https://255.255.255.255/", 1000).then(res => "status " + res.status, e => e.name);
      const { user, system } = process.cpuUsage(cpu);
      console.log(JSON.stringify({ warmup, outcome, cpuMs: (user + system) / 1000, wallMs: performance.now() - start }));
    `;
    // A proxy from the environment would make fetch refuse HTTP/3 up front.
    const { HTTP_PROXY, HTTPS_PROXY, http_proxy, https_proxy, ...env } = bunEnv;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", client],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { cpuMs, wallMs, ...rest }: CpuReport & Record<string, string> = JSON.parse(stdout);
    // Nothing can answer, so the request is pending for the whole second.
    expect(rest).toEqual({ warmup: "ok", outcome: "TimeoutError" });
    // A spinning thread uses as much CPU time as wall time. An idle one uses close to none.
    expect(cpuMs).toBeLessThan(wallMs / 2);
    expect(exitCode).toBe(0);
  },
);

test.skipIf(skip)("Bun.serve: a send error on every datagram does not spin the server's event loop", async () => {
  const report = await withServer(
    async port => {
      // Connect first, so that the handshake and the server's lazy setup are not measured.
      expect(await (await h3(port)).text()).toBe("ok");
      // The handler arms the rule, so the response to this request is the first datagram refused.
      const outcome = await h3(port, { signal: AbortSignal.timeout(1000) }, "/arm-server-fault").then(
        res => "status " + res.status,
        e => e.name,
      );
      expect(outcome).toBe("TimeoutError");
    },
    // What an iptables OUTPUT DROP rule does to every sendmsg() of the server.
    { syscall: "sendmsg", action: "errno", errno: constants.errno.EPERM, repeat: -1 },
  );
  const { cpuMs, wallMs }: CpuReport = JSON.parse(report);
  expect(cpuMs).toBeLessThan(wallMs / 2);
});

/**
 * One QUIC long-header datagram with an unsupported version, which makes the
 * server queue a Version Negotiation reply for a connection it does not have.
 * Built from a real Initial the HTTP/3 client sends, with the 4 version bytes
 * replaced: lsquic's parser rejects a hand-built header (`dcil <
 * MIN_INITIAL_DCID_LEN`, a token-length and a payload-length varint).
 */
async function unsupportedVersionDatagram(): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  await using sink = await Bun.udpSocket({
    port: 0,
    hostname: "127.0.0.1",
    socket: { data: (_s, data) => resolve(Buffer.from(data)) },
  });
  // The client's first datagram is the padded Initial. Nothing answers it, so
  // abort as soon as it arrives. A fetch that settles first never sent one
  // (a proxy from the environment makes fetch refuse HTTP/3, for example).
  const abort = new AbortController();
  const pending = fetch(`https://127.0.0.1:${sink.port}/`, {
    protocol: "http3",
    tls: { rejectUnauthorized: false },
    signal: abort.signal,
  } as RequestInit).then(res => reject(new Error("unexpected response, status " + res.status)), reject);
  const initial = await promise;
  abort.abort();
  await pending;
  // 0x0a0a0a0a: reserved for version negotiation (RFC 9000 section 15).
  initial.writeUInt32BE(0x0a0a0a0a, 1);
  return initial;
}

/** The versions a Version Negotiation packet offers (RFC 9000 section 17.2.1). Empty for any other packet. */
function offeredVersions(packet: Buffer): number[] {
  if (packet.length < 7 || !(packet[0] & 0x80) || packet.readUInt32BE(1) !== 0) return [];
  let at = 5;
  at += 1 + packet[at]; // destination connection ID
  at += 1 + packet[at]; // source connection ID
  const versions: number[] = [];
  for (; at + 4 <= packet.length; at += 4) versions.push(packet.readUInt32BE(at));
  return versions;
}

test.skipIf(skip)(
  "Bun.serve: a refused version-negotiation reply does not spin the loop when no connection exists",
  async () => {
    const datagram = await unsupportedVersionDatagram();
    {
      // Without a fault first: the server must answer this datagram with a
      // Version Negotiation packet. If it did not, nothing would be refused
      // below and the CPU check could not fail.
      await using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        tls,
        http3: true,
        http1: false,
        fetch: () => new Response("ok"),
      });
      const { promise, resolve } = Promise.withResolvers<Buffer>();
      await using sock = await Bun.udpSocket({
        port: 0,
        hostname: "127.0.0.1",
        socket: { data: (_s, data) => resolve(Buffer.from(data)) },
      });
      expect(sock.send(datagram, server.port, "127.0.0.1")).toBe(true);
      // The reply offers QUIC version 1, the version the HTTP/3 client speaks.
      expect(offeredVersions(await promise)).toContain(1);
    }
    const report = await withServer(
      async port => {
        await using sock = await Bun.udpSocket({ port: 0, hostname: "127.0.0.1", socket: { data() {} } });
        expect(sock.send(datagram, port, "127.0.0.1")).toBe(true);
        // Nothing to await: the reply never leaves the host. Measure a window.
        await Bun.sleep(1000);
      },
      // The reply is refused, like every other datagram under a DROP rule.
      { syscall: "sendmsg", action: "errno", errno: constants.errno.EPERM, repeat: -1 },
      // No request to hang the arming off: no connection is ever made.
      "listen",
    );
    const { cpuMs, wallMs }: CpuReport = JSON.parse(report);
    expect(cpuMs).toBeLessThan(wallMs / 2);
  },
);

/**
 * EMSGSIZE is the one send error lsquic acts on per datagram: it retires the
 * packet through `ci_packet_too_large` and feeds DPLPMTUD. `packets_out` passes
 * it through for that reason. Reported as EAGAIN instead, every DPLPMTUD probe
 * above the egress MTU pauses the engine and re-arms a writable poll, which
 * stalls the transfer that is in progress.
 *
 * An egress MTU below 1500 is the trigger. `IP_PMTUDISC_PROBE` (quic.c,
 * us_quic_set_dontfrag) only makes the kernel ignore its cached path MTU. The
 * device MTU still bounds the datagram.
 */
const MTU_SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdlib.h>
#include <sys/socket.h>

/* An egress interface that only fits UDP payloads up to FAKE_MAX_PAYLOAD
 * bytes. With DF set the kernel rejects a larger datagram with EMSGSIZE. */
/* The type of sendmmsg's flags differs: int on glibc, unsigned int on musl. */
#ifdef __GLIBC__
typedef int mmsg_flags_t;
#else
typedef unsigned int mmsg_flags_t;
#endif

static int (*real_sendmmsg)(int, struct mmsghdr *, unsigned, mmsg_flags_t);
static ssize_t (*real_sendmsg)(int, const struct msghdr *, int);
static size_t limit;

static void init(void) {
    if (limit) return;
    real_sendmmsg = dlsym(RTLD_NEXT, "sendmmsg");
    real_sendmsg = dlsym(RTLD_NEXT, "sendmsg");
    const char *e = getenv("FAKE_MAX_PAYLOAD");
    limit = e ? (size_t) atoi(e) : 1400;
}

static size_t total(const struct msghdr *m) {
    size_t t = 0;
    for (size_t i = 0; i < m->msg_iovlen; i++) t += m->msg_iov[i].iov_len;
    return t;
}

static int is_udp(int fd) {
    int type = 0; socklen_t l = sizeof(type);
    if (getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &l) != 0) return 0;
    return type == SOCK_DGRAM;
}

int sendmmsg(int fd, struct mmsghdr *mm, unsigned n, mmsg_flags_t flags) {
    init();
    if (!is_udp(fd)) return real_sendmmsg(fd, mm, n, flags);
    /* sendmmsg(2): stop at the first failing message. Report the count when
     * earlier ones went out (the error is lost), -1/EMSGSIZE otherwise. */
    unsigned k = 0;
    while (k < n && total(&mm[k].msg_hdr) <= limit) k++;
    if (k == n) return real_sendmmsg(fd, mm, n, flags);
    if (k == 0) { errno = EMSGSIZE; return -1; }
    return real_sendmmsg(fd, mm, k, flags);
}

ssize_t sendmsg(int fd, const struct msghdr *m, int flags) {
    init();
    if (is_udp(fd) && total(m) > limit) { errno = EMSGSIZE; return -1; }
    return real_sendmsg(fd, m, flags);
}
`;

// 16 KiB every 20 ms for 2.5 s: past packet 30, which is where DPLPMTUD starts
// probing, and past the 1 s probe timer twice, while the rate stays low enough
// that a healthy transfer cannot use a whole core.
const MTU_FIXTURE = /* js */ `
const CHUNK = Buffer.alloc(16 * 1024, 0x61);
await using server = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  ...${JSON.stringify({ tls, http3: true, http1: false })},
  fetch(req) {
    if (new URL(req.url).pathname === "/small") return new Response("ok");
    const end = performance.now() + 2500;
    return new Response(new ReadableStream({
      async pull(ctrl) {
        if (performance.now() >= end) return ctrl.close();
        ctrl.enqueue(CHUNK);
        await Bun.sleep(20);
      },
    }));
  },
});
const h3 = (path, ms) =>
  fetch("https://127.0.0.1:" + server.port + path, {
    protocol: "http3", tls: { rejectUnauthorized: false }, signal: AbortSignal.timeout(ms),
  });
const cpu = process.cpuUsage(), start = performance.now();
let bytes = 0, outcome, lastProgress = start;
try {
  const res = await h3("/stream", 20000);
  for await (const chunk of res.body) {
    bytes += chunk.length;
    lastProgress = performance.now();
  }
  outcome = "complete status " + res.status;
} catch (e) {
  outcome = "error " + e.name;
}
const { user, system } = process.cpuUsage(cpu);
const wallMs = performance.now() - start;
// A second request, to show the engine still works after the refused probes.
const second = await h3("/small", 3000).then(res => res.text(), e => "error " + e.name);
console.log(JSON.stringify({
  outcome, bytes, second,
  stalledMs: start + wallMs - lastProgress,
  cpuMs: (user + system) / 1000, wallMs,
}));
`;

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

test.skipIf(!isLinux || !cc)("a DPLPMTUD probe above the egress MTU does not stall the transfer", async () => {
  using dir = tempDir("h3-mtu", { "shim.c": MTU_SHIM_C, "client.mjs": MTU_FIXTURE });
  const shim = join(String(dir), "shim.so");
  await using build = Bun.spawn({
    cmd: [cc!, "-shared", "-fPIC", "-O1", "-o", shim, join(String(dir), "shim.c"), "-ldl"],
    env: bunEnv,
    stderr: "pipe",
  });
  const [buildErr, buildExit] = await Promise.all([build.stderr.text(), build.exited]);
  if (buildExit !== 0) throw new Error("shim compile failed: " + buildErr);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "client.mjs"],
    cwd: String(dir),
    // 1400 sits above lsquic's base packet size and below its first probe, so
    // only the probes are refused.
    env: { ...bunEnv, LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shim}:${bunEnv.LD_PRELOAD}` : shim, FAKE_MAX_PAYLOAD: "1400" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { bytes, stalledMs, cpuMs, wallMs, ...rest } = JSON.parse(stdout);
  expect(rest).toEqual({ outcome: "complete status 200", second: "ok" });
  expect(bytes).toBeGreaterThan(1024 * 1024);
  // The unfixed engine pauses on the first probe and never resumes: it delivers
  // about 32 KB, then stalls for the rest of the request.
  expect(stalledMs).toBeLessThan(1000);
  expect(cpuMs).toBeLessThan(wallMs);
  expect(exitCode).toBe(0);
});
