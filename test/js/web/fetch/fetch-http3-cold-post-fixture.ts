// A large POST over HTTP/3 as the very first request on the connection. The
// request headers and body must not starve the client's TLS Finished: without
// it the server cannot read any 1-RTT packet until the handshake times out.
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

type Server = { port: number; proc: Bun.Subprocess<"pipe", "ignore", "pipe">; drained: Promise<string> };

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
      if (m) ready.resolve({ port: Number(m[1]), proc, drained: drained! });
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
