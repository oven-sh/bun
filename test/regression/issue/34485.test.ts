import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/34485
// Middleware like @polka/compression (used by `vite preview`) replaces res.on
// and ends the response asynchronously from a zlib stream event. The server's
// internal detach-on-finish listener must be registered before the 'request'
// event so the middleware cannot swallow it; otherwise the next keep-alive
// request on the same socket throws ERR_HTTP_SOCKET_ASSIGNED and the server
// process dies.
test.concurrent("keep-alive requests survive middleware that wraps res.on/write/end", async () => {
  using dir = tempDir("issue-34485", {
    "server.js": `
      const http = require("http");
      const zlib = require("zlib");

      const BODY = Buffer.alloc(4096, "x").toString();

      // The relevant parts of @polka/compression: route writes through a gzip
      // stream, call the original end() from the gzip 'end' event, and divert
      // later res.on() registrations onto the gzip stream.
      function middleware(req, res) {
        const { end, write, on } = res;
        const compress = zlib.createGzip();
        res.setHeader("Content-Encoding", "gzip");
        compress.on("data", chunk => write.call(res, chunk) || compress.pause());
        on.call(res, "drain", () => compress.resume());
        compress.on("end", () => end.call(res));
        res.write = function (chunk, enc) {
          return compress.write(chunk, enc);
        };
        res.end = function (chunk, enc) {
          return compress.end(chunk, enc);
        };
        res.on = function (type, listener) {
          compress.on(type, listener);
          return this;
        };
      }

      const server = http.createServer((req, res) => {
        middleware(req, res);
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(BODY);
      });

      server.listen(0, "127.0.0.1", async () => {
        const port = server.address().port;
        const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
        const sockets = new Set();

        function get() {
          return new Promise((resolve, reject) => {
            http
              .get({ host: "127.0.0.1", port, agent, headers: { "accept-encoding": "gzip" } }, res => {
                sockets.add(res.socket);
                const chunks = [];
                res.on("data", c => chunks.push(c));
                res.on("end", () => resolve([res.statusCode, Buffer.concat(chunks)]));
                res.on("error", reject);
              })
              .on("error", reject);
          });
        }

        for (let i = 0; i < 3; i++) {
          const [status, body] = await get();
          const text = zlib.gunzipSync(body).toString();
          console.log(\`request \${i}: \${status} \${text.length} bytes ok=\${text === BODY}\`);
        }
        console.log("sockets used:", sockets.size);
        agent.destroy();
        server.close();
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout:
      "request 0: 200 4096 bytes ok=true\n" +
      "request 1: 200 4096 bytes ok=true\n" +
      "request 2: 200 4096 bytes ok=true\n" +
      "sockets used: 1\n",
    stderr: "",
    exitCode: 0,
  });
});

// Same middleware pattern, but the requests are pipelined (all sent in one
// packet). Queued responses rely on the same pre-registered detach-on-finish
// listener to advance the pipeline; pre-fix this crashed identically.
test.concurrent("pipelined requests survive middleware that wraps res.on/write/end", async () => {
  using dir = tempDir("issue-34485-pipelined", {
    "server.js": `
      const http = require("http");
      const net = require("net");
      const { PassThrough } = require("stream");

      // Same shape as @polka/compression, with an identity stream so the
      // response bytes stay directly assertable: writes routed through a
      // stream, end() called from its 'end' event, res.on() diverted onto it.
      function middleware(req, res) {
        const { end, write, on } = res;
        const compress = new PassThrough();
        compress.on("data", chunk => write.call(res, chunk) || compress.pause());
        on.call(res, "drain", () => compress.resume());
        compress.on("end", () => end.call(res));
        res.write = function (chunk, enc) {
          return compress.write(chunk, enc);
        };
        res.end = function (chunk, enc) {
          return compress.end(chunk, enc);
        };
        res.on = function (type, listener) {
          compress.on(type, listener);
          return this;
        };
      }

      const server = http.createServer((req, res) => {
        middleware(req, res);
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("body-of" + req.url + "|");
      });

      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        const sock = net.connect(port, "127.0.0.1", () => {
          sock.write(
            "GET /1 HTTP/1.1\\r\\nHost: a\\r\\n\\r\\n" +
              "GET /2 HTTP/1.1\\r\\nHost: a\\r\\n\\r\\n" +
              "GET /3 HTTP/1.1\\r\\nHost: a\\r\\nConnection: close\\r\\n\\r\\n",
          );
        });
        let data = "";
        sock.setEncoding("latin1");
        sock.on("data", c => (data += c));
        sock.on("end", () => {
          const statuses = data.split("HTTP/1.1 200").length - 1;
          const i1 = data.indexOf("body-of/1|");
          const i2 = data.indexOf("body-of/2|");
          const i3 = data.indexOf("body-of/3|");
          console.log("statuses:", statuses, "ordered:", i1 >= 0 && i1 < i2 && i2 < i3);
          server.close();
        });
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "statuses: 3 ordered: true\n",
    stderr: "",
    exitCode: 0,
  });
});
