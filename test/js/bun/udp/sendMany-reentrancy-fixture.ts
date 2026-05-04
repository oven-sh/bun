// Regression fixture: UDPSocket.sendMany() must snapshot the connected/
// disconnected state before iterating the payload array. Array index getters,
// port `valueOf()`, and address `toString()` can all re-enter JS and call
// connect()/disconnect() on the socket. If sendMany re-reads `connect_info` on
// every iteration, a mid-loop flip changes how slice indices are computed and
// either writes past the end of the payload/addr arena buffers (unconnected ->
// connected) or leaves slots uninitialized (connected -> disconnected).
import dgram from "node:dgram";

const direction = process.argv[2];
if (direction !== "connect" && direction !== "disconnect") {
  console.error("usage: sendMany-reentrancy-fixture.ts <connect|disconnect>");
  process.exit(2);
}

function once<T>(socket: dgram.Socket, event: string) {
  return new Promise<T>((resolve, reject) => {
    socket.once("error", reject);
    socket.once(event, (arg: T) => {
      socket.removeListener("error", reject);
      resolve(arg);
    });
  });
}

// Extract the underlying Bun.udpSocket() instance from a node:dgram Socket.
function getBunSocket(socket: dgram.Socket): any {
  for (const sym of Object.getOwnPropertySymbols(socket)) {
    const v = (socket as any)[sym];
    if (v && typeof v === "object" && v.handle && "socket" in v.handle) {
      return v.handle.socket;
    }
  }
  throw new Error("could not find Bun UDPSocket on dgram socket");
}

// Synchronous lookup: makes dgram.Socket#connect() set `connect_info` before
// it returns, so it can run to completion inside a valueOf()/getter callback.
const syncLookup: dgram.SocketOptions["lookup"] = (_host, opts: any, cb: any) => {
  if (typeof opts === "function") cb = opts;
  cb(null, "127.0.0.1", 4);
};

const target = dgram.createSocket({ type: "udp4", lookup: syncLookup });
target.bind(0, "127.0.0.1");
await once(target, "listening");
const targetPort = target.address().port;

const sock = dgram.createSocket({ type: "udp4", lookup: syncLookup });
sock.bind(0, "127.0.0.1");
await once(sock, "listening");

let flipped = false;

if (direction === "connect") {
  // Unconnected socket: array is parsed as [payload, port, address] triples.
  // 9 elements -> 3 packets -> arena buffers sized for 3 entries.
  // The first port's valueOf() synchronously connects the socket; without the
  // fix, iteration i=3 uses slice_idx = i = 3 and writes payloads[3] past the
  // end of a 3-element slice.
  const bunSocket = getBunSocket(sock);
  const evilPort = {
    valueOf() {
      if (!flipped) {
        flipped = true;
        sock.connect(targetPort, "127.0.0.1");
      }
      return targetPort;
    },
  };
  // prettier-ignore
  const packets: unknown[] = [
    "a", evilPort,   "127.0.0.1",
    "b", targetPort, "127.0.0.1",
    "c", targetPort, "127.0.0.1",
  ];

  try {
    bunSocket.sendMany(packets);
  } catch {
    // A thrown error is acceptable (e.g. EISCONN once the socket is connected);
    // the only thing that is not acceptable is a crash.
  }
} else {
  // Connected socket: every element is a payload and arena buffers are sized
  // for `array.length` entries. A getter on index 0 synchronously disconnects;
  // without the fix, the remaining iterations interpret the array as
  // [payload, port, address] triples and only fill slots 0..2, leaving slots
  // 3..8 uninitialized before they are handed to the native send path.
  sock.connect(targetPort, "127.0.0.1");
  await once(sock, "connect");
  const bunSocket = getBunSocket(sock);

  // prettier-ignore
  const packets: unknown[] = [
    "a", targetPort, "127.0.0.1",
    "b", targetPort, "127.0.0.1",
    "c", targetPort, "127.0.0.1",
  ];
  Object.defineProperty(packets, 0, {
    get() {
      if (!flipped) {
        flipped = true;
        sock.disconnect();
      }
      return "a";
    },
  });

  try {
    bunSocket.sendMany(packets);
  } catch {
    // EDESTADDRREQ or similar is fine; crashing is not.
  }
}

if (!flipped) throw new Error("re-entrant callback never ran");

try {
  sock.close();
} catch {}
target.close();

console.log("OK");
