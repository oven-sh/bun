import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// request() refuses these before the stream gets an id. The stream still emits 'ready'.
const refused = {
  "a :path with a space": `{ ":path": "/a b" }`,
  "content-length on a DELETE": `{ ":method": "DELETE", "content-length": "1" }`,
};

test.concurrent.each(Object.entries(refused))(
  "close() on a request that was refused before it got a stream id (%s)",
  async (_, headers) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
        const http2 = require("node:http2");
        const server = http2.createServer((req, res) => res.end("ok"));
        server.listen(0, "127.0.0.1", () => {
          const client = http2.connect("http://127.0.0.1:" + server.address().port);
          client.on("connect", () => {
            const req = client.request(${headers});
            req.on("error", () => {});
            req.on("close", () => {
              console.log("close");
              client.close();
              server.close();
            });
            req.close();
          });
        });
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("close\n");
    // The RST_STREAM that close() queued at 'ready' threw "Invalid stream id" from setImmediate.
    expect(exitCode).toBe(0);
  },
);
