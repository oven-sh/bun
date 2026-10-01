// A clock for bytes in transit over loopback, for the TLS handshake-queue fixtures in this
// directory. Their steps need to know that bytes (or a FIN) have reached a socket that does not
// read them.
//
// Loop iterations are not that clock, and neither is the sender's write callback. Linux runs the
// loopback receive path inside send(), so there the bytes have arrived when send() returns. macOS
// hands loopback segments to a kernel input thread, and on a busy machine they arrive many loop
// iterations later.
//
// Both kernels deliver loopback segments in the order sent. So when a byte written to an echo
// pair has come back, every segment that any process sent before that write has arrived.
//
// The pair is plain TCP, so the TLS handshake budget never holds it back.
const waiting: (() => void)[] = [];

async function connect() {
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket, bytes) {
        socket.write(bytes);
      },
    },
  });
  const socket = await Bun.connect({
    hostname: "127.0.0.1",
    port: listener.port,
    socket: {
      data(_, bytes) {
        for (let i = 0; i < bytes.length; i++) waiting.shift()?.();
      },
    },
  });
  return { listener, socket };
}
let pair: ReturnType<typeof connect> | undefined;

/** Resolves when everything that was sent over loopback before the call has arrived. */
export async function loopbackRoundTrip() {
  const { socket } = await (pair ??= connect());
  const { promise, resolve } = Promise.withResolvers<void>();
  waiting.push(resolve);
  socket.write("x");
  await promise;
}
