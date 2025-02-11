import { expect, test } from "bun:test";
test("remix works", async () => {
  process.env.PORT = "0";
  process.exitCode = 1;
  process.env.NODE_ENV = "production";
  process.env.HOST = "localhost";
  process.argv = [process.argv[0], ".", require("path").join(__dirname, "remix-build", "server", "index.js")];
  const http = require("node:http");
  const originalListen = http.Server.prototype.listen;
  let { promise, resolve, reject } = Promise.withResolvers();
  http.Server.prototype.listen = function listen(...args) {
    setTimeout(() => {
      resolve(this.address());
    }, 10);
    return originalListen.apply(this, args);
  };

  require("@remix-run/serve/dist/cli.js");

  // Wait long enough for the server's setTimeout to run.
  await Bun.sleep(10);

  const port = (await promise).port;

  ({ promise, resolve, reject } = Promise.withResolvers());
  let chunks = [];
  const req = http
    .request(`http://localhost:${port}`, res => {
      res
        .on("data", data => {
          chunks.push(data);
        })
        .on("end", () => {
          resolve();
        })
        .on("error", reject);
    })
    .end();

  await promise;
  const data = Buffer.concat(chunks).toString();
  expect(data).toContain("Remix Docs");
  process.exitCode = 0;
});
