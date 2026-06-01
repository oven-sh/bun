// Survivor side of the "busy-loop on half-closed UDS" regression
// (see node-net.test.ts "should emit close ... when a backpressured peer is killed").
//
// Listens on a UDS, and on connect immediately floods the peer with data so the
// kernel send buffer fills and µSockets marks the socket backpressured
// (last_write_failed). The test then SIGKILLs the peer. The survivor must
// receive a single 'close' and exit 0. Before the fix, 'close' never fired and
// this process hung forever (spinning on the half-closed fd).
const net = require("node:net");

const sockPath = process.env.UDS_PATH;

// Watchdog: if 'close' never arrives, fail loudly instead of hanging forever.
const watchdog = setTimeout(() => {
  console.error("survivor: timed out waiting for close");
  process.exit(3);
}, 15_000);

let closeCount = 0;

const server = net.createServer(socket => {
  console.log("ACCEPTED");

  const big = Buffer.alloc(8 * 1024 * 1024, 0x41);
  const pump = () => {
    // Write until the kernel applies backpressure.
    while (socket.write(big)) {}
  };
  socket.on("drain", pump);
  pump();

  socket.on("data", () => {});
  socket.on("end", () => {});
  socket.on("error", () => {});
  socket.on("close", () => {
    closeCount++;
    clearTimeout(watchdog);
    server.close();
    // Give a tick to catch any erroneous second 'close', then report.
    setImmediate(() => {
      if (closeCount !== 1) {
        console.error(`survivor: expected exactly one close, got ${closeCount}`);
        process.exit(4);
      }
      process.exit(0);
    });
  });
});

server.on("error", err => {
  console.error("survivor: server error", err);
  process.exit(5);
});

server.listen(sockPath, () => {
  console.log("LISTENING");
});
