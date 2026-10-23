import { expect, test } from "bun:test";
import { bunExe } from "harness";
import { run } from "../../../aot/harness/run";

test("a class stored in `net.Socket` is not the base of an HTTP server's connections", async () => {
  const { stdout, stderr, exitCode } = await run([
    bunExe(),
    "-e",
    `
      const net = require("node:net"), http = require("node:http");
      const Original = net.Socket;
      class Other extends Original {}
      net.Socket = Other;
      const server = http.createServer((req, res) => {
        console.log(req.socket instanceof Original, req.socket instanceof Other);
        res.end();
        server.close();
      });
      server.listen(0, () => {
        net.Socket = Original;
        http.get({ port: server.address().port, agent: false }, res => res.resume());
      });
      `,
  ]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "true false", stderr: "", exitCode: 0 });
});
