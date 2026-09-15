import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("pipelined response replay does not re-enter monkey-patched write/end (#40350)", async () => {
  // Compression middleware (@polka/compression, used by vite preview) patches
  // res.write/res.end as own properties that feed a gzip stream, and sends the
  // gzip output through the captured prototype write/end. Those prototype
  // calls are what advanceResponsePipeline buffers for a queued pipelined
  // response, so the replay must call the prototype implementations too:
  // replaying through the patched res.write fed the already-compressed bytes
  // back into the ended gzip stream and killed the process with an uncaught
  // ERR_STREAM_WRITE_AFTER_END.
  const script = String.raw`
    const http = require("node:http");
    const net = require("node:net");
    const zlib = require("node:zlib");

    const BODY = Buffer.alloc(4096, "x").toString();

    function compression(res) {
      const { end, write, on } = res;
      const gzip = zlib.createGzip();
      gzip.on("data", chunk => write.call(res, chunk) || gzip.pause());
      on.call(res, "drain", () => gzip.resume());
      gzip.on("end", () => end.call(res));
      res.setHeader("Content-Encoding", "gzip");
      res.write = function (chunk, enc) {
        return gzip.write(chunk, enc);
      };
      res.end = function (chunk, enc) {
        return gzip.end(chunk, enc);
      };
    }

    const server = http.createServer((req, res) => {
      compression(res);
      res.setHeader("Content-Type", "text/plain");
      res.write(BODY);
      res.end();
    });

    // Collect the terminated chunked bodies that are complete so far.
    function parseBodies(buf) {
      const bodies = [];
      let off = 0;
      while (true) {
        const headerEnd = buf.indexOf("\r\n\r\n", off);
        if (headerEnd === -1) return bodies;
        let pos = headerEnd + 4;
        const chunks = [];
        while (true) {
          const lineEnd = buf.indexOf("\r\n", pos);
          if (lineEnd === -1) return bodies;
          const size = parseInt(buf.toString("latin1", pos, lineEnd), 16);
          if (!(size >= 0)) return bodies;
          if (size === 0) {
            pos = lineEnd + 4;
            break;
          }
          if (buf.length < lineEnd + 2 + size + 2) return bodies;
          chunks.push(buf.subarray(lineEnd + 2, lineEnd + 2 + size));
          pos = lineEnd + 2 + size + 2;
        }
        bodies.push(Buffer.concat(chunks));
        off = pos;
      }
    }

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const sock = net.connect(port, "127.0.0.1", () => {
        // Both requests in one packet: the second response is queued behind
        // the first and its writes are buffered for replay.
        sock.write(
          "GET /a HTTP/1.1\r\nHost: x\r\nAccept-Encoding: gzip\r\n\r\n" +
            "GET /b HTTP/1.1\r\nHost: x\r\nAccept-Encoding: gzip\r\n\r\n",
        );
      });
      let buf = Buffer.alloc(0);
      sock.on("data", c => {
        buf = Buffer.concat([buf, c]);
        const bodies = parseBodies(buf);
        if (bodies.length >= 2) {
          for (const body of bodies) {
            const text = zlib.gunzipSync(body).toString();
            if (text !== BODY) {
              console.error("body mismatch: got " + text.length + " bytes");
              process.exit(1);
            }
          }
          console.log("OK");
          process.exit(0);
        }
      });
      // A stall or truncation would otherwise idle until the test timeout
      // with no diagnostic.
      sock.on("close", () => {
        console.error("closed with " + buf.length + " bytes: " + buf.toString("latin1"));
        process.exit(1);
      });
    });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("write after end");
  expect(stdout).toBe("OK\n");
  expect(exitCode).toBe(0);
});
