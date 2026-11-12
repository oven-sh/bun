// Prints the poll count of the event loop after each of several TLS connections is gone. The arguments say how each
// one ends. Every connection first fills the kernel, so sealed records wait in the TLS engine and hold the event loop.
// A hold that is not given back, or is given back twice, moves the count.
//
// Both ends are in this process: each close is an event here, and the count is taken when both have come.
import type { Socket } from "bun";
import { getEventLoopStats } from "bun:internal-for-testing";
import { tls } from "harness";

const megabyte = Buffer.alloc(1024 * 1024, "a");

let accepted = Promise.withResolvers<Socket>();
let acceptedClosed = Promise.withResolvers<void>();
const listener = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  tls,
  socket: {
    // It reads nothing until the other end has filled the kernel.
    handshake(socket) {
      socket.pause();
      accepted.resolve(socket);
    },
    data() {},
    close: () => acceptedClosed.resolve(),
  },
});

async function countAfter(ending: string) {
  accepted = Promise.withResolvers();
  acceptedClosed = Promise.withResolvers();
  const opened = Promise.withResolvers<Socket>();
  const closed = Promise.withResolvers<void>();
  let filled = false;
  await Bun.connect({
    hostname: "127.0.0.1",
    port: listener.port,
    tls: { rejectUnauthorized: false },
    socket: {
      handshake: socket => opened.resolve(socket),
      data() {},
      drain(socket) {
        if (filled && ending === "end() after the drain") socket.end();
      },
      close: () => closed.resolve(),
    },
  });
  const [socket, peer] = await Promise.all([opened.promise, accepted.promise]);
  // Until the kernel takes no more: the rest of what write() counted is sealed, and waits.
  while (socket.write(megabyte) === megabyte.length);
  filled = true;

  switch (ending) {
    case "end() after the drain":
    case "the peer's terminate()":
      break;
    case "end()":
      socket.end();
      break;
    case "close()":
      socket.close();
      break;
    case "terminate()":
      socket.terminate();
      break;
    default:
      throw new Error(`unknown ending ${ending}`);
  }
  if (ending === "the peer's terminate()") peer.terminate();
  else peer.resume();

  await Promise.all([closed.promise, acceptedClosed.promise]);
  // A socket leaves the event loop when its close handler has returned.
  await new Promise<void>(resolve => setImmediate(resolve));
  return getEventLoopStats().numPolls;
}

const counts: number[] = [];
for (const ending of process.argv.slice(2)) counts.push(await countAfter(ending));
console.log(JSON.stringify(counts));
listener.stop(true);
