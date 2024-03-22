import { createServer } from "http";
var server = createServer((req, res) => {
  res.end();
}).listen(0, async (err, hostname, port) => {
  process.on("SIGUSR1", async () => {
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
  process.kill(process.pid, "SIGUSR1");
});
