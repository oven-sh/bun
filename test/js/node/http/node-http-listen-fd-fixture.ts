// The child of the `listen({ fd })` tests in node-http.test.ts. The parent
// bound a socket and passed it to this process as descriptor LISTEN_FD. This
// process serves on it and prints one JSON line when ready. The file runs
// unchanged under node.
import { existsSync, fstatSync, readdirSync, readlinkSync } from "node:fs";
import type { Server } from "node:http";

const fd = Number(process.env.LISTEN_FD);
const body = "served by " + process.env.LISTEN_NONCE;

// The number of sockets this process has open. Linux only.
function sockets() {
  if (process.platform !== "linux") return 0;
  let count = 0;
  for (const entry of readdirSync("/proc/self/fd")) {
    try {
      if (readlinkSync("/proc/self/fd/" + entry).startsWith("socket:")) count++;
    } catch {}
  }
  return count;
}

const before = sockets();
// LISTEN_TLS is a certificate and a key, or nothing for a plain server. The
// module loads on demand: a debug build takes about a second for each.
const server: Server = process.env.LISTEN_TLS
  ? (await import("node:https")).createServer(JSON.parse(process.env.LISTEN_TLS), (_req, res) => res.end(body))
  : (await import("node:http")).createServer((_req, res) => res.end(body));
server.on("error", error => {
  console.log(JSON.stringify({ error: { code: (error as any).code, syscall: (error as any).syscall } }));
  process.exit(1);
});
// LISTEN_OPTIONS holds options that the descriptor must win over.
server.listen({ fd, ...JSON.parse(process.env.LISTEN_OPTIONS || "{}") }, () => {
  console.log(
    JSON.stringify({ address: server.address(), listening: server.listening, newSockets: sockets() - before }),
  );
});

// The parent sends SIGHUP when its requests are done.
process.on("SIGHUP", () => {
  server.close(() => {
    let state = "open";
    try {
      fstatSync(fd);
    } catch (e: any) {
      state = e.code;
    }
    console.log(
      JSON.stringify({
        fd: state,
        unlinked: process.env.LISTEN_PATH ? !existsSync(process.env.LISTEN_PATH) : undefined,
      }),
    );
    process.exit(0);
  });
});
