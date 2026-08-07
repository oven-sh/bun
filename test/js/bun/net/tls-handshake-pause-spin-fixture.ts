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

const client = await Bun.connect({
  hostname: "127.0.0.1",
  port: server.port,
  tls: { rejectUnauthorized: false },
  socket: { open(s) { s.pause(); }, handshake() {}, data() {}, end() {}, error() {}, close() {} },
});

// Let the pause-time writable event and handshake kick settle first.
await Bun.sleep(100);

const before = process.cpuUsage();
await Bun.sleep(2000);
const delta = process.cpuUsage(before);
const cpuMs = (delta.user + delta.system) / 1000;

console.log(`cpu over 2000ms stall window: ${Math.round(cpuMs)}ms`);
client.terminate();

// Spinning burns roughly the whole window; a quiet loop stays far below this
// even under debug+ASAN on a loaded CI machine.
if (cpuMs > 800) {
  console.error(`SPIN: ${Math.round(cpuMs)}ms CPU while a paused TLS handshake idled`);
  process.exit(1);
}
process.exit(0);
