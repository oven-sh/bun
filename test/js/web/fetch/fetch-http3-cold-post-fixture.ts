// A large POST over HTTP/3 as the very first request on the connection, so
// on_hsk_done and on_new_stream fire in the same lsquic ci_tick. The request
// headers and body must not starve the client's TLS Finished on the HSK
// crypto stream. Before the fix, writing the request synchronously from
// on_stream_open filled the send controller from inside the crypto-read
// phase and (when the pacer throttled) left the 36-byte Finished
// unpacketized; the server stayed a mini-conn and dropped every 1-RTT packet
// until the handshake timeout. The fix defers the whole request to on_write,
// which lsquic's priority iterator serves after the crypto stream.
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
  http1: false,
  async fetch(req) {
    const buf = await req.arrayBuffer();
    return new Response(String(buf.byteLength));
  },
});
console.error("PORT=" + server.port);
process.stdin.on("data", () => {});
process.stdin.on("end", () => process.exit(0));
`;

type Server = { port: number; proc: ReturnType<typeof Bun.spawn>; drained: Promise<string> };

function spawnServer(servers: Server[]): Promise<Server> {
  const proc = Bun.spawn({
    cmd: [bunExe(), "-e", serverSrc],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
    stdin: "pipe",
  });
  const ready = Promise.withResolvers<Server>();
  // Keep the whole stderr buffered: readiness resolves at PORT=, and the
  // remaining output stays drained so a chatty server can't wedge its pipe.
  const drained = (async () => {
    let buf = "";
    for await (const chunk of proc.stderr) {
      buf += new TextDecoder().decode(chunk);
      const m = buf.match(/PORT=(\d+)/);
      if (m) ready.resolve({ port: Number(m[1]), proc, drained });
    }
    ready.reject(new Error("no PORT from server: " + buf));
    return buf;
  })();
  // Registered before awaiting readiness so a reject in a sibling spawn (or
  // this one never emitting PORT=) still reaps this process.
  servers.push({ port: 0, proc, drained });
  return ready.promise;
}

const BODY = 1_000_000;
const body = Buffer.alloc(BODY, 0x61);
// A multi-packet header block (just under the server's 16 KB
// es_max_header_list_size) exercises send_headers_ietf going through the
// same buffered-packet path from on_write.
const bigHeaders: Record<string, string> = {};
for (let i = 0; i < 12; i++) bigHeaders["x-pad-" + i] = Buffer.alloc(1000, 0x62).toString();

type Shape = { init: RequestInit; want: string };
const PAR = 8;
const shapes: Shape[] = [
  { init: { method: "POST", body }, want: String(BODY) },
  { init: { method: "GET", headers: bigHeaders }, want: "0" },
];
let fail = 0;

for (const { init, want } of shapes) {
  if (fail) break;
  const servers: Server[] = [];
  try {
    const ready = await Promise.all(Array.from({ length: PAR }, () => spawnServer(servers)));
    const results = await Promise.allSettled(
      ready.map(s =>
        fetch(`https://127.0.0.1:${s.port}/`, {
          ...init,
          // @ts-ignore
          protocol: "http3",
          tls: { rejectUnauthorized: false },
          // 2 shapes x 10 s keeps the fixture inside the wrapper's 30 s
          // budget so a wedged handshake self-reports via exit code.
          signal: AbortSignal.timeout(10_000),
        } as any).then(r => r.text()),
      ),
    );
    for (const [i, r] of results.entries()) {
      if (r.status === "rejected" || r.value !== want) {
        fail++;
        console.error("FAIL", i, r.status === "rejected" ? String(r.reason) : r.value);
      }
    }
  } finally {
    for (const s of servers) {
      s.proc.stdin?.end();
      s.proc.kill();
    }
    await Promise.all(servers.map(s => Promise.all([s.proc.exited, s.drained])));
  }
}
process.exit(fail);
