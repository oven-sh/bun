// The child of the `Bun.serve({ fd })` tests in serve-listen.test.ts. The
// parent bound a socket and passed it to this process as descriptor
// LISTEN_FD. This process serves on it and prints one JSON line when ready.
import { existsSync, fstatSync, readdirSync, readlinkSync } from "node:fs";

const fd = Number(process.env.LISTEN_FD);
// Options that `fd` must win over, or nothing.
const options = JSON.parse(process.env.LISTEN_OPTIONS || "{}");

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

function errorOf(run: () => unknown) {
  try {
    run();
  } catch (e: any) {
    return { code: e.code, syscall: e.syscall, fd: e.fd };
  }
}

const before = sockets();
const server = Bun.serve({
  ...options,
  fd,
  // A certificate and a key, or nothing for a plain server.
  tls: process.env.LISTEN_TLS ? JSON.parse(process.env.LISTEN_TLS) : undefined,
  fetch(request, server) {
    const { pathname } = new URL(request.url);
    if (pathname === "/peer") {
      return Response.json({
        requestIP: server.requestIP(request),
        timeout: server.timeout(request, 30) === null ? "null" : "undefined",
      });
    }
    if (pathname === "/ws" && server.upgrade(request)) return;
    return new Response("served by " + process.env.LISTEN_NONCE);
  },
  websocket: {
    message(ws, message) {
      ws.send("echo " + message);
    },
  },
});
console.log(
  JSON.stringify({
    url: String(server.url),
    port: server.port,
    hostname: server.hostname,
    address: server.address,
    newSockets: sockets() - before,
    class: Object.prototype.toString.call(server),
    // A second listener on the descriptor must fail and leave the first one alone.
    second: process.env.LISTEN_TWICE ? errorOf(() => Bun.serve({ fd, fetch: () => new Response() })) : undefined,
  }),
);

// The parent sends SIGHUP when its requests are done.
process.on("SIGHUP", async () => {
  await server.stop(true);
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
