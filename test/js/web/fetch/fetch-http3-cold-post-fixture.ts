// A large POST over HTTP/3 as the very first request on the connection, so
// on_hsk_done and on_new_stream fire in the same lsquic ci_tick. The request
// body writer must not starve the client's TLS Finished on the HSK crypto
// stream. Before the fix, writing the body synchronously from on_stream_open
// filled the send controller from inside the crypto-read phase and (when the
// pacer throttled) left the 36-byte Finished unpacketized; the server stayed
// a mini-conn and dropped every 1-RTT packet until the handshake timeout.
// The fix defers body bytes to on_write, which lsquic's priority iterator
// serves after the crypto stream.
//
// This is regression coverage for the fixed code path, not a deterministic
// reproduction of the race (which needs the handshake RTT to push lsquic's
// pacer past its clock-granularity gate, and that depends on scheduler
// timing that cannot be forced from JS). See the PR for the lsquic trace
// that proves the deadlock and the fix.
//
// Parent spawns this with bunExe() and asserts exit 0.
import { bunEnv, bunExe, tls } from "harness";

// One subprocess server per cold handshake so the client's h3 engine cannot
// reuse a connection, and so the handshake RTT is a real process boundary
// instead of in-process loopback.
const serverSrc = `
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  tls: ${JSON.stringify(tls)},
  http3: true,
  async fetch(req) {
    const buf = await req.arrayBuffer();
    return new Response(String(buf.byteLength));
  },
});
console.error("PORT=" + server.port);
process.stdin.on("data", () => {});
`;

async function spawnServer() {
  const proc = Bun.spawn({
    cmd: [bunExe(), "-e", serverSrc],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
    stdin: "pipe",
  });
  let buf = "";
  for await (const chunk of proc.stderr) {
    buf += new TextDecoder().decode(chunk);
    const m = buf.match(/PORT=(\d+)/);
    if (m) return { port: Number(m[1]), proc };
    if (buf.length > 4096) break;
  }
  proc.kill();
  throw new Error("no PORT from server: " + buf);
}

const BODY = 1_000_000;
const body = Buffer.alloc(BODY, 0x61);
const PAR = 12;
const ROUNDS = 4;
let fail = 0;

for (let round = 0; round < ROUNDS && fail === 0; round++) {
  const servers = await Promise.all(Array.from({ length: PAR }, spawnServer));
  const results = await Promise.allSettled(
    servers.map(s =>
      fetch(`https://127.0.0.1:${s.port}/`, {
        method: "POST",
        body,
        // @ts-ignore
        protocol: "http3",
        tls: { rejectUnauthorized: false },
        signal: AbortSignal.timeout(60_000),
      } as any).then(r => r.text()),
    ),
  );
  for (const r of results) {
    if (r.status === "rejected" || r.value !== String(BODY)) {
      fail++;
      console.error("FAIL", r.status === "rejected" ? String(r.reason) : r.value);
    }
  }
  for (const s of servers) {
    s.proc.stdin?.end();
    s.proc.kill();
  }
  await Promise.all(servers.map(s => s.proc.exited));
}
process.exit(fail);
