import { once } from "events";
import { isWindows } from "harness";
import { createServer } from "http";

if (isWindows) process.exit(0); // Windows doesnt support SIGUSR1

const SIGNAL = process.platform === "linux" ? "SIGUSR2" : "SIGUSR1";
const server = createServer((req, res) => {
  res.end();
});
server.listen(0);
await once(server, "listening");
const port = server.address().port;
process.on(SIGNAL, async () => {
  server.unref();

  // check that the server is still running
  const resp = await fetch(`http://localhost:${port}`);
  await resp.arrayBuffer();
  console.log("Unref'd & server still running (as expected)");
});
const resp = await fetch(`http://localhost:${port}`);
await resp.arrayBuffer();
if (resp.status !== 200) {
  process.exit(42);
}
process.kill(process.pid, SIGNAL);
