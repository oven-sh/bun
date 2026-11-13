// A write that is in flight on an unref'd TLS socket. report(shape, version)
// runs the peer in this process and the other end in a child of the same
// runtime. It resolves with what the child completed before it exited on its
// own, and with what the peer received. node-tls-connect.test.ts runs it in bun
// and in node, and expects the same reports from both.
//
// The child gets a write in flight: the peer reads nothing, so the kernel takes
// only what it can hold. From then on nothing but the socket holds the child's
// event loop. A child that is still alive a moment later says "idle", and the
// peer answers: it starts to read, or it resets the connection.
//
// Every child loads what this file imports here. What only one shape or the peer needs is imported where it is used.
import { once } from "node:events";
import { readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const keys = join(import.meta.dirname, "..", "test", "fixtures", "keys");
const pem = name => readFileSync(join(keys, name));
const chunk = Buffer.alloc(64 * 1024, 0x61);

const accepted = "writes on an accepted socket";
const beforeHandshake = "a write made before the handshake";
const reset = "the peer resets the connection";
// Its peer reads from the start: the upload is more than the kernel holds.
const upload = "an upload on an unref'd http2 session";
// The peer of these two never reads.
const parked = "a write that still waits for the handshake";
const destroyed = "destroy() with a write in flight";

const serverOptions = version => ({
  key: pem("agent1-key.pem"),
  cert: pem("agent1-cert.pem"),
  minVersion: version,
  maxVersion: version,
});

async function child(shape, version, port) {
  const state = { writes: 0, ran: 0, sent: 0, errors: [] };
  process.on("exit", () => console.log(JSON.stringify(state)));
  // A child that cannot exit must not outlive the test.
  setTimeout(() => process.exit(3), 60_000).unref();

  const watch = socket => socket.on("error", error => state.errors.push(`socket ${error.code}`));
  const write = (socket, data, method = "write") => {
    state.writes++;
    state.sent += data.length;
    socket[method](data, error => {
      if (error) state.errors.push(`${method} ${error.code}`);
      else state.ran++;
    });
  };
  const turn = () => new Promise(setImmediate);
  // Writes until a write stays in flight: one that the kernel took whole is
  // complete within a few turns of the event loop. Twice as much again then
  // waits behind it, so that the kernel cannot take the rest on its own later.
  const writeUntilInFlight = async (socket, last = "write") => {
    for (;;) {
      const completed = state.ran;
      write(socket, chunk);
      for (let turns = 0; turns < 4 && state.ran === completed; turns++) await turn();
      if (state.ran === completed) break;
    }
    write(socket, Buffer.alloc(2 * state.sent, 0x62), last);
  };
  const options = { port, host: "127.0.0.1", rejectUnauthorized: false, minVersion: version, maxVersion: version };

  switch (shape) {
    case "unref() before the writes": {
      const socket = watch(tls.connect(options));
      await once(socket, "secureConnect");
      socket.unref();
      await writeUntilInFlight(socket);
      break;
    }
    case "unref() while a write is in flight": {
      const socket = watch(tls.connect(options));
      await once(socket, "secureConnect");
      await writeUntilInFlight(socket);
      socket.unref();
      break;
    }
    case "end(data) after unref()": {
      const socket = watch(tls.connect(options));
      await once(socket, "secureConnect");
      socket.unref();
      await writeUntilInFlight(socket, "end");
      break;
    }
    case "unref() of the net.Socket before tls.connect({ socket })": {
      // The timer holds the event loop until the handshake is done.
      const keep = setInterval(() => {}, 2 ** 30);
      const raw = watch(net.connect(port, "127.0.0.1"));
      await once(raw, "connect");
      raw.unref();
      const socket = watch(tls.connect({ ...options, socket: raw }));
      await once(socket, "secureConnect");
      clearInterval(keep);
      await writeUntilInFlight(socket);
      break;
    }
    case accepted: {
      const server = tls.createServer(serverOptions(version));
      server.on("tlsClientError", () => {});
      await once(server.listen(0, "127.0.0.1"), "listening");
      // The peer dials.
      console.log(`connect ${server.address().port}`);
      const [socket] = await once(server, "secureConnection");
      watch(socket);
      server.unref();
      socket.unref();
      await writeUntilInFlight(socket);
      break;
    }
    case beforeHandshake: {
      // The timer holds the event loop until a write that was made before the
      // handshake is still in flight after it.
      const keep = setInterval(() => {}, 2 ** 30);
      // More than the kernel holds for one connection: it cannot take the rest on its own a moment later.
      for (let size = 8 * 1024 * 1024; ; size *= 2) {
        const socket = watch(tls.connect(options));
        socket.unref();
        state.writes = state.ran = state.sent = 0;
        write(socket, Buffer.alloc(size, 0x62));
        await once(socket, "secureConnect");
        await turn();
        if (state.ran === 0) break;
        // The kernel took it whole.
        socket.destroy();
      }
      clearInterval(keep);
      break;
    }
    case parked: {
      // The peer never answers the ClientHello.
      const socket = watch(tls.connect(options));
      socket.unref();
      write(socket, chunk);
      return;
    }
    case destroyed: {
      const socket = tls.connect(options);
      await once(socket, "secureConnect");
      await writeUntilInFlight(socket);
      socket.destroy();
      // No event tells that a process stays. This timer does not hold the event loop, so it only runs in one that does.
      setTimeout(() => process.exit(4), 3000).unref();
      return;
    }
    case upload: {
      const http2 = await import("node:http2");
      const session = http2.connect(`https://127.0.0.1:${port}`, options);
      session.on("error", error => state.errors.push(`session ${error.code}`));
      // The peer's SETTINGS and WINDOW_UPDATE come ahead of its first response, so its windows are open after this.
      const ready = session.request({ ":path": "/ready" });
      ready.resume();
      await once(ready, "end");
      session.unref();
      const request = session.request({ ":method": "POST", ":path": "/" });
      request.on("error", error => state.errors.push(`request ${error.code}`));
      // The session sends this itself: no write of the TLSSocket is pending for it.
      write(request, Buffer.alloc(16 * 1024 * 1024, 0x62), "end");
      return;
    }
    case reset: {
      const socket = watch(tls.connect(options));
      await once(socket, "secureConnect");
      socket.unref();
      await writeUntilInFlight(socket);
      // As in destroy(): from the close on, this only runs in a process that stays.
      socket.on("close", () => setTimeout(() => process.exit(4), 3000).unref());
      break;
    }
    default:
      throw new Error(`unknown shape ${shape}`);
  }
  // This timer does not hold the event loop: it only runs while the write in flight does.
  setTimeout(() => console.log("idle"), 1).unref();
}

export async function report(shape, version) {
  // The peer's end of each connection. The last one is the connection under test.
  const sockets = [];
  const closed = new Map();
  const hold = socket => {
    socket.on("error", () => {});
    closed.set(socket, new Promise(resolve => socket.on("close", resolve)));
    sockets.push(socket);
  };

  let received = 0;
  let server;
  if (shape === parked) {
    server = net.createServer(hold);
  } else if (shape === upload) {
    const http2 = await import("node:http2");
    // Flow control does not stop the upload: the peer's windows are larger than it.
    const window = 2 ** 30;
    server = http2.createSecureServer({ ...serverOptions(version), settings: { initialWindowSize: window } });
    server.on("session", session => session.setLocalWindowSize(window));
    server.on("secureConnection", hold);
    server.on("stream", (stream, headers) => {
      stream.on("error", () => {});
      if (headers[":path"] === "/ready") return stream.end("ready");
      stream.on("data", data => (received += data.length));
      // Not before: input that the child has not read when it exits resets the connection under the rest of the upload.
      stream.on("end", () => stream.end("done"));
    });
  } else if (shape !== accepted) {
    server = tls.createServer(serverOptions(version), hold);
    server.on("tlsClientError", () => {});
  }
  if (server) await once(server.listen(0, "127.0.0.1"), "listening");

  const { spawn } = await import("node:child_process");
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), shape, version, String(server ? server.address().port : 0)],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  try {
    let answered = false;
    // What the peer does for a child that is idle with its write in flight.
    const answer = () => {
      if (answered || shape === parked || shape === destroyed || shape === upload) return;
      answered = true;
      // It has read nothing, so its close is a reset.
      if (shape === reset) sockets.at(-1)?.destroy();
      else sockets.at(-1)?.on("data", data => (received += data.length));
    };

    let stdout = "";
    let handled = 0;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", text => {
      stdout += text;
      for (let end; (end = stdout.indexOf("\n", handled)) !== -1; handled = end + 1) {
        const line = stdout.slice(handled, end);
        if (line === "idle") answer();
        else if (line.startsWith("connect ")) {
          hold(tls.connect({ port: Number(line.slice(8)), host: "127.0.0.1", rejectUnauthorized: false }));
        }
      }
    });
    const [exitCode] = await once(child, "close");
    // After a child that exited early, the peer reads what the kernel still has.
    answer();
    if (answered || shape === upload) await closed.get(sockets.at(-1));

    const { writes, ran, sent, errors } = JSON.parse(stdout.trimEnd().split("\n").at(-1));
    return {
      callbacks: writes > 0 && ran === writes ? "all" : `${ran} of ${writes}`,
      delivered: sent > 0 && received === sent ? "all" : `${received} of ${sent}`,
      errors,
      exitCode,
    };
  } finally {
    child.kill();
    for (const socket of sockets) socket.destroy();
    server?.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [shape, version, port] = process.argv.slice(2);
  await child(shape, version, Number(port));
}
