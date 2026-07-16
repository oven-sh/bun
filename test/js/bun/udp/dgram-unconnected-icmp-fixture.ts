import dgram from "node:dgram";

function bind(socket: dgram.Socket): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const onError = (err: Error) => reject(err);
  socket.once("error", onError);
  socket.bind(0, "127.0.0.1", () => {
    // Leave no "error" listener behind: node never emits one for an unconnected
    // socket, so real dgram code does not install one either.
    socket.removeListener("error", onError);
    resolve(socket.address().port);
  });
  return promise;
}

function close(socket: dgram.Socket): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  socket.close(() => resolve());
  return promise;
}

const live = dgram.createSocket("udp4");
const livePort = await bind(live);

const sender = dgram.createSocket("udp4");
await bind(sender);

// Bind and close a probe to get a port nothing is listening on. It is bound
// last so the kernel cannot hand the same port to `live` or `sender`.
const probe = dgram.createSocket("udp4");
const deadPort = await bind(probe);
await close(probe);

const sendErrors: string[] = [];
const received: string[] = [];

for (let i = 0; i < 5; i++) {
  const { promise: settled, resolve: done } = Promise.withResolvers<void>();
  const onMessage = (msg: Buffer) => {
    received.push(msg.toString());
    done();
  };
  live.once("message", onMessage);

  // The peer on deadPort is gone, so localhost answers with ICMP port
  // unreachable while this sendto() is still in the kernel. It must not reach
  // the socket's "error" event, and it must not land in the callback of the
  // unrelated send that immediately follows.
  sender.send("dead", deadPort, "127.0.0.1", err => {
    if (err) sendErrors.push(`dead:${(err as NodeJS.ErrnoException).code}`);
  });
  sender.send(`live-${i}`, livePort, "127.0.0.1", err => {
    if (err) {
      sendErrors.push(`live:${(err as NodeJS.ErrnoException).code}`);
      // This datagram never left, so no message is coming: unblock the loop
      // instead of hanging.
      done();
    }
  });

  await settled;
  live.removeListener("message", onMessage);
}

console.log(JSON.stringify({ sendErrors, received }));

await close(sender);
await close(live);
