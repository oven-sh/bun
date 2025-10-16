// Due to the interaction between TLS and WebSocket I/O, the socket may continuously appear readable even when no data is available, leading to repeated EAGAIN or EWOULDBLOCK responses and 100% CPU usage.
// Switching to edge-triggered mode (EV_CLEAR or EPOLLET) ensures events are only delivered on state changes, reducing CPU usage to approximately 0.XX%.

const server = Bun.serve({
  port: 0,
  idleTimeout: 100,
  tls: {
    cert: Bun.file(process.env.CERT_PATH),
    key: Bun.file(process.env.KEY_PATH),
  },
  fetch(req, server) {
    if (server.upgrade(req)) {
      return;
    }
    return new Response("Upgrade failed", { status: 500 });
  },
  websocket: {
    idleTimeout: 120,
    open(ws) {},
    message(ws, message) {
      ws.send(message);
    },
  },
});

const ws = new WebSocket(`wss://${server.hostname}:${server.port}`, { tls: { rejectUnauthorized: false } });
await Bun.sleep(1000);
for (let i = 0; i < 1000; i++) {
  ws.send("hello");
}
let bytesReceived = 0;
ws.onmessage = event => {
  bytesReceived += event.data.length;
};

let previousUsage = process.cpuUsage();
let previousTime = Date.now();

let count = 0;
setInterval(() => {
  count++;

  const currentUsage = process.cpuUsage(previousUsage);
  const currentTime = Date.now();

  const userCpuTime = currentUsage.user; // microseconds
  const systemCpuTime = currentUsage.system; // microseconds
  const totalCpuTime = userCpuTime + systemCpuTime;

  const timeDeltaMs = currentTime - previousTime; // milliseconds
  const timeDeltaMicroseconds = timeDeltaMs * 1000; // convert to microseconds

  // Calculate percentage for the current process
  const cpuUsagePercentage = (totalCpuTime / timeDeltaMicroseconds) * 100;

  console.log(`CPU Usage: ${cpuUsagePercentage.toFixed(2)}%`);

  previousUsage = process.cpuUsage(); // Update for the next interval
  previousTime = currentTime;

  if (count == 2) {
    server.stop(true);
    // The expected value is around 0.XX%, but we allow a 2% margin of error to account for potential flakiness.
    process.exit(cpuUsagePercentage < 2 ? 0 : 1);
  }
}, 1000);
