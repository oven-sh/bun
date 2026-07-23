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
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls } from "harness";

const skip = !fault.available() || isWindows;

const spawned: Bun.Subprocess[] = [];
afterEach(async () => {
  fault.clear();
  for (const p of spawned.splice(0)) {
    p.stdin?.end();
    const killTimer = setTimeout(() => p.kill(), 500);
    try {
      await p.exited;
    } finally {
      clearTimeout(killTimer);
    }
  }
});

async function spawnServer(): Promise<number> {
  using dir = tempDir("h3-fault", {
    "server.mjs": `
      const server = Bun.serve({
        port: 0, hostname: "127.0.0.1",
        ...${JSON.stringify({ tls, http3: true, http1: false })},
        fetch: () => new Response("ok"),
      });
      console.error("PORT=" + server.port);
      process.stdin.on("end", () => { server.stop(true); setTimeout(() => process.exit(0), 50); });
      process.stdin.resume();
    `,
  });
  const proc = Bun.spawn({
    cmd: [bunExe(), "server.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
    stdin: "pipe",
  });
  spawned.push(proc);
  let buf = "";
  for await (const chunk of proc.stderr) {
    buf += new TextDecoder().decode(chunk);
    const m = buf.match(/PORT=(\d+)/);
    if (m) return Number(m[1]);
    if (buf.length > 4096) break;
  }
  throw new Error("server did not report a port:\n" + buf);
}

const h3 = (port: number, init: RequestInit = {}) =>
  fetch(`https://127.0.0.1:${port}/`, {
    ...init,
    protocol: "http3",
    tls: { rejectUnauthorized: false },
    signal: AbortSignal.timeout(8000),
  } as RequestInit);

test.skipIf(skip)(
  "EAGAIN on the coalesced handshake datagram is requeued and the fetch completes",
  async () => {
    const port = await spawnServer();

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
  },
  30_000,
);

test.skipIf(skip)(
  "a non-backpressure send error on the first datagram is retried and does not pause the engine",
  async () => {
    const port = await spawnServer();

    // ECONNREFUSED on the very first send is what a stale ICMP on the shared
    // client socket looks like. us_quic_packets_out retries once; the retry
    // is a real send and the handshake proceeds normally.
    fault.set({ syscall: "sendmsg", action: "errno", errno: "ECONNREFUSED", after: 0, repeat: 1 });

    const res = await h3(port);
    expect(await res.text()).toBe("ok");
    expect(res.status).toBe(200);
  },
  30_000,
);

test.skipIf(skip)(
  "repeated EAGAIN over several loop iterations recovers via on_drain without stalling the fetch",
  async () => {
    const port = await spawnServer();

    // Fail the first handful of sends with EAGAIN. Each failure re-arms the
    // UDP poll's writable interest; on_drain → send_unsent_packets runs on
    // the next iteration, so progress resumes as soon as the rule disarms.
    // The 8s abort is well above lsquic's one-second resume_sending_at
    // failsafe, so the only way to time out is an engine-level stall.
    fault.set({ syscall: "sendmsg", action: "errno", errno: "EAGAIN", after: 0, repeat: 5 });

    const res = await h3(port);
    expect(await res.text()).toBe("ok");
    expect(res.status).toBe(200);
  },
  30_000,
);
