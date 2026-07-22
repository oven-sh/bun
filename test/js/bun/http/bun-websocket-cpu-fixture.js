import path from "path";

const server = Bun.serve({
  port: 0,
  idleTimeout: 100,
  tls: {
    cert: Bun.file(path.join(import.meta.dir, "fixtures", "cert.pem")),
    key: Bun.file(path.join(import.meta.dir, "fixtures", "cert.key")),
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
const { promise: openWS, resolve: onWSOpen } = Promise.withResolvers();
ws.onopen = onWSOpen;
await openWS;
for (let i = 0; i < 1000; i++) {
  ws.send("hello");
}
let bytesReceived = 0;
const { promise: drained, resolve: onDrained } = Promise.withResolvers();
ws.onmessage = event => {
  bytesReceived += event.data.length;
  // "hello" is 5 bytes; wait for all 1000 echoes so the sampling below
  // measures idle CPU, not the burst drain (which on loaded runners bleeds
  // into the verdict sample).
  if (bytesReceived >= 5000) onDrained();
};
await drained;
// Let the loop settle before the first sample window opens.
await Bun.sleep(500);

let previousUsage = process.cpuUsage();
let previousTime = Date.now();

let count = 0;
let minCpuUsagePercentage = Infinity;
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
  minCpuUsagePercentage = Math.min(minCpuUsagePercentage, cpuUsagePercentage);

  console.log(`CPU Usage: ${cpuUsagePercentage.toFixed(2)}%`);

  previousUsage = process.cpuUsage(); // Update for the next interval
  previousTime = currentTime;

  if (count == 3) {
    server.stop(true);
    // The #25475 regression spins the event loop at ~100% on every sample; an idle
    // loop reads ~0% (up to a few % on Windows where GetProcessTimes charges whole
    // ~15.6ms ticks). Gate on the quietest sample with the same 50% bound as 21654.
    process.exit(minCpuUsagePercentage < 50 ? 0 : 1);
  }
}, 1000);
