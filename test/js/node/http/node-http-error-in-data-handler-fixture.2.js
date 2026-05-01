const http = require("http");
const server = http.createServer(async (req, res) => {
  res.end("Hello World\n");
});
const { promise, resolve, reject } = Promise.withResolvers();
process.exitCode = 1;

server.listen(0, function () {
  const port = server.address().port;
  http
    .request(`http://localhost:${port}`, res => {
      res
        .on("data", async data => {
          await Bun.sleep(1);
          // base64 the message to ensure we don't confuse source code with the error message
          throw new Error(Buffer.from("VGVzdCBwYXNzZWQ=", "base64"));
        })
        .on("end", () => {
          server.close();
        });
    })
    .on("error", reject)
    .end();
});

server.on("close", () => {
  resolve();
});
server.on("error", err => {
  reject(err);
});

process.on("unhandledRejection", err => {
  console.log(err);
  process.exit(0);
});
