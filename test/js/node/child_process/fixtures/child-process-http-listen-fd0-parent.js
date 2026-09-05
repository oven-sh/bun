const net = require("node:net");
const path = require("node:path");

const server = net.createServer();
server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  const child = Bun.spawn({
    cmd: [process.execPath, path.join(__dirname, "child-process-http-listen-fd0-child.js")],
    stdio: [server._handle.fd, "pipe", "inherit"],
    env: { ...process.env },
    cwd: __dirname,
  });
  server.close();
  const decoder = new TextDecoder();
  let childOut = "";
  for await (const chunk of child.stdout) {
    childOut += decoder.decode(chunk, { stream: true });
    if (childOut.includes("ready")) break;
  }
  console.log("child alive:", child.exitCode === null);
  const res = await fetch("http://127.0.0.1:" + port + "/", { signal: AbortSignal.timeout(5000) });
  console.log("response:", await res.text());
  child.kill();
  process.exit(0);
});
