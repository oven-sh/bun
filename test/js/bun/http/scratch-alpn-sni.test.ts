import { test } from "bun:test";
import { bunEnv, bunExe, tls as COMMON_CERT } from "harness";
import { connect } from "node:tls";

function probe(port: number, ALPNProtocols: string[] | undefined, servername = "localhost") {
  const { promise, resolve } = Promise.withResolvers<{ alpn?: string | false; code?: string }>();
  const socket = connect({ host: "127.0.0.1", port, servername, ca: COMMON_CERT.cert, ALPNProtocols }, () => {
    resolve({ alpn: socket.alpnProtocol });
    socket.destroy();
  });
  socket.on("error", (err: NodeJS.ErrnoException) => resolve({ code: err.code }));
  return promise;
}

test("array ALPNProtocols on Bun.serve", async () => {
  using server = Bun.serve({
    port: 0,
    tls: { ...COMMON_CERT, ALPNProtocols: ["h2", "http/1.1"] as any },
    fetch: () => new Response("hello"),
  });
  console.log("array, client h2/h1 ->", await probe(server.port, ["h2", "http/1.1"]));
  console.log("array, client 'h2,http/1.1' ->", await probe(server.port, ["h2,http/1.1"]));
});

test("fetch protocol http2 against Bun.serve https", async () => {
  using server = Bun.serve({ port: 0, tls: { ...COMMON_CERT }, fetch: () => new Response("hello") });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "--no-warnings",
      "-e",
      `try {
         await fetch("https://localhost:${server.port}", { protocol: "http2", tls: { rejectUnauthorized: false } });
         console.log("unexpected-ok");
       } catch (e) { console.log(e.code || String(e)); }`,
    ],
    env: { ...bunEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  console.log("fetch h2 -> Bun.serve:", JSON.stringify(stdout.trim()), stderr.trim().slice(0, 200));
});

test("plain fetch still works", async () => {
  using server = Bun.serve({ port: 0, tls: { ...COMMON_CERT }, fetch: () => new Response("hello") });
  const res = await fetch(server.url, { tls: { rejectUnauthorized: false } });
  console.log("plain fetch:", res.status, await res.text());
});
