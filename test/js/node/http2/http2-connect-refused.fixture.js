// Connect an http2 client to a port nothing listens on and print the shape of the
// session's 'error'. Run under Node.js and under Bun: the output must be identical.
const http2 = require("node:http2");
const net = require("node:net");

const probe = net.createServer();
probe.listen(0, "127.0.0.1", () => {
  const port = probe.address().port;
  probe.close(() => {
    const client = http2.connect(`http://127.0.0.1:${port}`);
    client.on("connect", () => {
      console.log("FAIL: connected to a closed port");
      client.destroy();
      process.exitCode = 1;
    });
    client.on("error", err => {
      console.log(
        JSON.stringify({
          code: err.code,
          syscall: err.syscall,
          address: err.address,
          portMatches: err.port === port,
          // errno is platform-specific (-111 on Linux, -61 on macOS), the name is not.
          message: err.message.replaceAll(String(port), "<port>"),
        }),
      );
      client.destroy();
    });
  });
});
