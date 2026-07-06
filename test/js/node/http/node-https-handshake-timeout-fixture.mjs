// Exercises https.createServer's handshakeTimeout in one process (TLS accept is
// slow under debug+ASAN, so amortize the startup cost across all scenarios).
// Prints one RESULT line per scenario; the test file asserts on them.
import https from "node:https";
import net from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const keys = join(import.meta.dir, "..", "test", "fixtures", "keys");
const key = readFileSync(join(keys, "agent1-key.pem"), "utf8");
const cert = readFileSync(join(keys, "agent1-cert.pem"), "utf8");
const ca = readFileSync(join(keys, "ca1-cert.pem"), "utf8");

function emit(name, value) {
  console.log(`RESULT ${name} ${value}`);
}

// 1. A peer that connects over TCP but never starts the handshake must be
//    dropped via 'tlsClientError' with ERR_TLS_HANDSHAKE_TIMEOUT.
async function silentPeer() {
  const server = https.createServer({ key, cert, handshakeTimeout: 200 }, () => {});
  const { promise, resolve } = Promise.withResolvers();
  let code = "NONE";
  server.on("tlsClientError", err => {
    code = err.code;
  });
  server.listen(0, "127.0.0.1", () => {
    const c = net.connect(server.address().port, "127.0.0.1");
    c.on("error", () => {});
    c.on("close", () => resolve(true));
    // Generous upper bound: if the watchdog never armed the peer stays open and
    // this resolves with the socket still alive, failing the assertion below.
    const guard = setTimeout(() => {
      emit("silent_still_open", !c.destroyed);
      c.destroy();
      resolve(false);
    }, 8000);
    guard.unref?.();
  });
  await promise;
  emit("silent_code", code);
  await new Promise(r => server.close(r));
}

// 2. A real request that completes the handshake well inside the window must
//    not be killed by the watchdog.
async function liveRequest() {
  const server = https.createServer({ key, cert, handshakeTimeout: 200 }, (_req, res) => res.end("ok"));
  let sawClientError = false;
  server.on("tlsClientError", () => {
    sawClientError = true;
  });
  const { promise, resolve } = Promise.withResolvers();
  server.listen(0, "127.0.0.1", () => {
    const req = https.request(
      { port: server.address().port, host: "127.0.0.1", ca, servername: "agent1" },
      res => {
        const chunks = [];
        res.on("data", d => chunks.push(d));
        res.on("end", () => resolve(Buffer.concat(chunks).toString()));
      },
    );
    req.on("error", err => {
      emit("live_req_error", err.code);
      resolve("ERROR");
    });
    req.end();
  });
  const body = await promise;
  emit("live_body", body);
  emit("live_client_error", sawClientError);
  await new Promise(r => server.close(r));
}

// 3. A non-numeric handshakeTimeout is rejected, like node:tls's own validation.
function invalidOption() {
  try {
    https.createServer({ key, cert, handshakeTimeout: "soon" });
    emit("invalid_throw", "NO_THROW");
  } catch (err) {
    emit("invalid_throw", err.code);
  }
}

await silentPeer();
await liveRequest();
invalidOption();
process.exit(0);
