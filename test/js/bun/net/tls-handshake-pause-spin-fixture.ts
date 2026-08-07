// A paused mid-handshake TLS socket must not spin the event loop.
//
// ssl_update_handshake used to set last_write_failed on SSL_ERROR_WANT_READ,
// so any writable interest on a socket whose handshake stalled (pause() arms
// writable) re-fired every tick: writable -> SSL_do_handshake -> WANT_READ ->
// keep writable armed -> immediately writable again, at 100% CPU until the
// peer's handshake bytes arrived. With reads paused they never do.
//
// The server here is plain TCP and never sends a ServerHello, so the client
// handshake stays pending; pause() in open() then holds the stall window.

using server = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: { open() {}, data() {}, end() {}, error() {}, close() {} },
});

// Any of these firing means the stall precondition broke and the CPU check
// below would be measuring the wrong state.
let preconditionFailure: string | undefined;
const opened = Promise.withResolvers<void>();

const client = await Bun.connect({
  hostname: "127.0.0.1",
  port: server.port,
  tls: { rejectUnauthorized: false },
  socket: {
    open(s) {
      s.pause();
      opened.resolve();
    },
    handshake() {
      preconditionFailure ??= "handshake completed";
    },
    data() {},
    end() {
      preconditionFailure ??= "socket ended";
    },
    error(_s, err) {
      preconditionFailure ??= `socket error: ${err}`;
    },
    close() {
      preconditionFailure ??= "socket closed";
    },
  },
});

// Wait for open (where pause() armed writable), then yield one macrotask so
// the pause-time writable dispatch and handshake kick land outside the
// measurement window.
await opened.promise;
await Bun.sleep(0);

const before = process.cpuUsage();
await Bun.sleep(2000);
const delta = process.cpuUsage(before);
const cpuMs = (delta.user + delta.system) / 1000;

console.log(`cpu over 2000ms stall window: ${Math.round(cpuMs)}ms`);
const failure = preconditionFailure;
client.terminate();

if (failure) {
  console.error(`TLS stall precondition failed: ${failure}`);
  process.exit(1);
}

// Spinning burns roughly the whole window; a quiet loop stays far below this
// even under debug+ASAN on a loaded CI machine.
if (cpuMs > 800) {
  console.error(`SPIN: ${Math.round(cpuMs)}ms CPU while a paused TLS handshake idled`);
  process.exit(1);
}
process.exit(0);
