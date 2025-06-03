import { createServer } from "http";
const SIGNAL = process.platform === "linux" ? "SIGUSR2" : "SIGUSR1";
var server = createServer((req, res) => {
  res.end();
}).listen(0, async (err, hostname, port) => {
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
});
