export async function responseCorkOracle(mode: string) {
  const assert = require("node:assert/strict");
  const http = require("node:http");
  const net = require("node:net");
  const { once } = require("node:events");
  const { setImmediate: immediate } = require("node:timers/promises");
  const { pipeline } = require("node:stream/promises");
  if (mode.startsWith("standalone")) {
    const chunks: Buffer[] = [];
    const finished = Promise.withResolvers<void>();
    const written = Promise.withResolvers<void>();
    let callbacks = 0;
    const server = http.createServer();
    server.on("upgrade", (_req, socket) => {
      const req = new http.IncomingMessage(socket);
      req.httpVersionMajor = 1;
      req.httpVersionMinor = 1;
      const res = new http.ServerResponse(req);
      res.assignSocket(socket);
      res.strictContentLength = mode === "standalone-strict";
      res.setHeader("content-length", 2);
      const onWrite = error => {
        assert.ifError(error);
        if (++callbacks === 2) written.resolve();
      };
      res.on("finish", () => {
        finished.resolve();
        socket.end();
      });
      res.cork();
      res.write("A", onWrite);
      res.write("B", onWrite);
      res.end();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const client = net.connect(server.address().port, "127.0.0.1");
    client.on("data", chunk => chunks.push(chunk));
    try {
      await once(client, "connect");
      client.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n");
      await once(client, "close");
      await Promise.all([finished.promise, written.promise]);
      assert.equal(callbacks, 2);
      assert.match(Buffer.concat(chunks).toString(), /^HTTP\/1\.1 200 OK\r\n/);
      assert.ok(Buffer.concat(chunks).toString().endsWith("\r\n\r\nAB"));
    } finally {
      client.destroy();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(resolve));
    }
    console.log("ok");
    return;
  }
  const chunks: Buffer[] = [];
  const discardsResponse =
    mode === "destroy" || mode === "destroy-no-error" || mode === "strict-end" || mode === "strict-first-write";
  const second = Promise.withResolvers<void>();
  const reassigned = Promise.withResolvers<void>();
  const completed = Promise.withResolvers<void>();
  let handled = 0;
  let client;
  let first: any;
  const highWaterMark = mode === "accounting" ? 64 : mode === "native-queued" ? 64 * 1024 * 1024 : 1024;
  const server = http.createServer({ highWaterMark }, (req, res) => {
    if (req.url === "/barrier") return res.end("barrier");
    handled++;
    if (handled === 2) {
      assert.equal(res.socket, null);
      res.setHeader("content-length", 2);
      res.cork();
      if (mode === "reassigned-no-body") {
        res.statusCode = 204;
        res.write("ignored");
        res.end();
        second.resolve();
        return;
      }
      if (mode === "reassigned-informational") {
        let callbackRan = false;
        res.writeContinue(() => (callbackRan = true));
        res.once("socket", () => {
          void (async () => {
            await barrier();
            assert.equal(Buffer.concat(chunks).includes("100 Continue"), false);
            assert.equal(callbackRan, false);
            res.uncork();
            res.end("C");
          })().then(reassigned.resolve, reassigned.reject);
        });
        res.write("B");
        second.resolve();
        return;
      }
      res.write("B");
      res.end("C");
      assert.equal(res.writableCorked, 0);
      second.resolve();
      return;
    }
    first = res;
    void handle(res).then(completed.resolve, completed.reject);
  });
  const counts = res => [res.writableCorked, res.socket.writableCorked];
  const barrier = async () => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/barrier`);
    await response.arrayBuffer();
    await immediate();
  };
  async function handle(res) {
    if (mode === "informational-pressure") {
      res.setHeader("content-length", 2);
      const written = Promise.withResolvers<void>();
      let callbacks = 0;
      res.cork();
      res.writeEarlyHints({ link: `</${"a".repeat(8 * 1024 * 1024)}>; rel=preload` }, error => {
        if (error) written.reject(error);
        else {
          callbacks++;
          written.resolve();
        }
      });
      res.uncork();
      res.end("AB");
      await barrier();
      assert.equal(callbacks, 0);
      client.resume();
      await written.promise;
      assert.equal(callbacks, 1);
      return;
    }
    if (mode === "bodyless-write") {
      res.statusCode = 204;
      res.cork();
      const written = new Promise<void>((resolve, reject) => {
        assert.equal(
          res.write("ignored", error => (error ? reject(error) : resolve())),
          true,
        );
      });
      res.end();
      await written;
      return;
    }
    if (mode.startsWith("strict-")) {
      res.strictContentLength = true;
      const contentLength = ["4"];
      res.setHeader("content-length", contentLength);
      res.cork();
      if (mode === "strict-no-body") {
        res.statusCode = 204;
        assert.throws(() => res.write(undefined), { code: "ERR_INVALID_ARG_TYPE" });
        res.end("AB");
      } else if (mode === "strict-mutable-header") {
        res.write("AB");
        contentLength[0] = "6";
        res.end("CD");
      } else if (mode === "strict-end") {
        assert.throws(() => res.end("AB"), { code: "ERR_HTTP_CONTENT_LENGTH_MISMATCH" });
        res.destroy();
      } else if (mode === "strict-first-write") {
        assert.equal(res.write("ABCDE"), true);
        assert.throws(() => res.end(), { code: "ERR_HTTP_CONTENT_LENGTH_MISMATCH" });
        res.destroy();
      } else {
        assert.equal(res.write("AB"), true);
        assert.throws(() => res.write("CDE"), { code: "ERR_HTTP_CONTENT_LENGTH_MISMATCH" });
        res.end("CD");
      }
      return;
    }
    if (mode === "pipeline") {
      res.setHeader("content-length", 4 * 1024 * 1024);
      res.cork();
      let reads = 0;
      const started = Promise.withResolvers<void>();
      const sending = pipeline(async function* () {
        for (let i = 0; i < 8; i++) {
          reads++;
          started.resolve();
          yield Buffer.alloc(512 * 1024, 65);
        }
      }, res);
      // Register failure handling before any assertion can interrupt the source.
      sending.catch(() => {});
      await started.promise;
      for (let i = 0; i < 4; i++) await immediate();
      await barrier();
      assert.equal(chunks.length, 0);
      assert.equal(reads, 1);
      assert.equal(res.writableCorked, 1);
      assert.equal(res.writableNeedDrain, true);
      assert.ok(res.writableLength >= 512 * 1024);
      res.uncork();
      await sending;
      return;
    }
    if (mode.startsWith("reassigned")) {
      res.setHeader("content-length", 1);
      res.cork();
      res.write("A");
      await second.promise;
      assert.equal(chunks.length, 0);
      res.uncork();
      res.end();
      return;
    }
    if (mode === "native-raw-drain" || mode === "native-queued") {
      const large = Buffer.alloc(32 * 1024 * 1024, 65);
      res.setHeader("content-length", large.length + (mode === "native-raw-drain" ? 1 : 0));
      let drains = 0;
      res.on("drain", () => drains++);
      if (mode === "native-queued") {
        res.cork();
        const written = new Promise<void>(resolve => assert.equal(res.write(large, resolve), true));
        res.uncork();
        assert.equal(res.writableNeedDrain, false);
        await written;
        await immediate();
        assert.equal(drains, 0);
      } else {
        const drained = once(res, "drain");
        assert.equal(res.write(large), false);
        const written = new Promise<void>((resolve, reject) =>
          res.socket.write("B", error => (error ? reject(error) : resolve())),
        );
        await Promise.all([drained, written]);
        assert.equal(drains, 1);
      }
      assert.equal(res.writableNeedDrain, false);
      res.end();
      return;
    }
    if (mode === "raw-drain") {
      const large = Buffer.alloc(16 * 1024 * 1024, 66);
      res.setHeader("content-length", large.length + 2048);
      let drains = 0;
      res.on("drain", () => drains++);
      assert.equal(res.write(Buffer.alloc(2048, 65)), false);
      await new Promise<void>((resolve, reject) =>
        res.socket.write(large, error => (error ? reject(error) : resolve())),
      );
      await immediate();
      assert.equal(res.writableNeedDrain, false);
      assert.equal(drains, 1);
      res.end();
      return;
    }
    if (mode === "interleaved" || mode === "after-uncork") {
      const large = Buffer.alloc(16 * 1024 * 1024, 65);
      res.setHeader("content-length", large.length + (mode === "interleaved" ? 4 : 3));
      res.cork();
      assert.equal(res.write(large), false);
      if (mode === "interleaved") res.socket.write("B");
      res.write("C");
      res.uncork();
      assert.equal(res.socket.writableCorked, 0);
      assert.ok(res.socket.writableLength > 0);
      res.write("D");
      if (mode === "interleaved") res.socket.write("E", () => res.end());
      else res.end("E");
      return;
    }
    if (mode !== "cross-chunked") res.setHeader("content-length", mode === "high-water" ? 2048 : 2);
    if (mode === "accounting") {
      res.sendDate = false;
      res.cork();
      assert.equal(res.write("A"), true);
      assert.equal(res.writableLength, 58);
      assert.equal(res.writableNeedDrain, false);
      res.end("B");
      return;
    }
    if (mode === "headers-frozen") {
      const value = ["before"];
      res.setHeader("x-proof", value);
      res.cork();
      res.write("A");
      value[0] = "after";
      res.end("B");
      return;
    }
    if (mode === "destroy" || mode === "destroy-no-error") {
      const callbacks = [];
      const writes = [];
      res.cork();
      writes.push(
        new Promise<void>(resolve =>
          res.write("A", error => {
            callbacks.push(error?.code);
            resolve();
          }),
        ),
      );
      writes.push(
        new Promise<void>(resolve =>
          res.socket.write("B", error => {
            callbacks.push(error?.code);
            resolve();
          }),
        ),
      );
      res.socket.on("error", () => {});
      res.socket.destroy(
        mode === "destroy" ? Object.assign(new Error("corked abort"), { code: "CORKED_ABORT" }) : undefined,
      );
      await Promise.all(writes);
      const code = mode === "destroy" ? "CORKED_ABORT" : "ERR_STREAM_DESTROYED";
      assert.deepEqual(callbacks, [code, code]);
      assert.equal(chunks.length, 0);
      return;
    }
    if (mode === "headers" || mode === "informational") {
      res.cork();
      if (mode === "headers") {
        res.flushHeaders();
        assert.equal(res.headersSent, true);
      } else {
        res.writeContinue();
      }
      res.write("A");
      await barrier();
      assert.equal(chunks.length, 0);
      res.uncork();
    } else if (mode === "callbacks") {
      const callbacks = [];
      res.cork();
      const responseWrite = new Promise<void>(resolve =>
        res.write("A", () => {
          callbacks.push("response");
          resolve();
        }),
      );
      const rawWrite = new Promise<void>(resolve =>
        res.socket.write("B", () => {
          callbacks.push("raw");
          resolve();
        }),
      );
      res.uncork();
      await Promise.all([responseWrite, rawWrite]);
      assert.deepEqual(callbacks, ["response", "raw"]);
      res.end();
      return;
    } else if (mode === "counts") {
      assert.equal(res.write.length, 3);
      assert.equal(res.end.length, 3);
      assert.deepEqual(counts(res), [0, 0]);
      res.cork();
      assert.deepEqual(counts(res), [1, 1]);
      res.cork();
      assert.deepEqual(counts(res), [2, 2]);
      res.write("A");
      res.uncork();
      assert.deepEqual(counts(res), [1, 1]);
      await barrier();
      assert.equal(chunks.length, 0);
      res.uncork();
      assert.deepEqual(counts(res), [0, 0]);
    } else if (mode === "cross-content-length" || mode === "cross-chunked") {
      res.cork();
      res.write("A");
      res.socket.uncork();
      assert.deepEqual(counts(res), [1, 0]);
      await barrier();
      if (mode === "cross-chunked") assert.equal(chunks.length, 0);
      res.uncork();
      assert.deepEqual(counts(res), [0, 0]);
    } else if (mode === "socket-cork") {
      res.socket.cork();
      assert.deepEqual(counts(res), [0, 1]);
      res.write("A");
      res.uncork();
      assert.deepEqual(counts(res), [-1, 0]);
    } else if (mode === "end-corked") {
      res.socket.cork();
      res.cork();
      res.cork();
      res.write("A");
      res.end("B");
      assert.deepEqual(counts(res), [0, 0]);
      return;
    } else if (mode === "high-water") {
      res.cork();
      let callbacks = 0;
      let drains = 0;
      res.on("drain", () => drains++);
      assert.equal(
        res.write(Buffer.alloc(2048, 65), () => callbacks++),
        false,
      );
      await barrier();
      assert.equal(chunks.length, 0);
      assert.equal(callbacks, 0);
      assert.equal(drains, 0);
      assert.equal(res.writableNeedDrain, true);
      assert.ok(res.writableLength >= 2048);
      const drained = once(res, "drain");
      res.uncork();
      await drained;
      await immediate();
      assert.equal(res.writableNeedDrain, false);
      assert.equal(callbacks, 1);
      assert.equal(drains, 1);
      res.end();
      return;
    } else {
      res.cork();
      res.write("A");
      assert.equal(chunks.length, 0);
      await new Promise<void>(resolve => (mode === "next-tick" ? process.nextTick(resolve) : setTimeout(resolve, 0)));
      res.uncork();
    }
    res.end("B");
  }
  function parseResponses(bytes) {
    const bodies = [];
    while (bytes.length) {
      const headerEnd = bytes.indexOf("\r\n\r\n");
      assert.ok(headerEnd >= 0);
      const header = bytes.subarray(0, headerEnd).toString();
      bytes = bytes.subarray(headerEnd + 4);
      if (/^HTTP\/1\.1 1\d\d /.test(header)) continue;
      if (/^HTTP\/1\.1 (204|304) /.test(header)) {
        bodies.push(Buffer.alloc(0));
        continue;
      }
      if (/transfer-encoding: chunked/i.test(header)) {
        const parts = [];
        while (true) {
          const lineEnd = bytes.indexOf("\r\n");
          const size = parseInt(bytes.subarray(0, lineEnd).toString(), 16);
          assert.ok(Number.isFinite(size));
          bytes = bytes.subarray(lineEnd + 2);
          if (!size) {
            bytes = bytes.subarray(2);
            break;
          }
          parts.push(bytes.subarray(0, size));
          bytes = bytes.subarray(size + 2);
        }
        bodies.push(Buffer.concat(parts));
      } else {
        const length = Number(/content-length: (\d+)/i.exec(header)?.[1]);
        assert.ok(Number.isFinite(length));
        assert.ok(bytes.length >= length);
        bodies.push(bytes.subarray(0, length));
        bytes = bytes.subarray(length);
      }
    }
    return bodies;
  }
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    client = net.connect(server.address().port, "127.0.0.1");
    if (mode === "informational-pressure") client.pause();
    const closed = new Promise<void>((resolve, reject) => {
      client.on("data", chunk => chunks.push(chunk));
      client.on("error", error => {
        if (!discardsResponse) reject(error);
      });
      client.on("close", resolve);
    });
    closed.catch(() => {});
    client.write(
      mode.startsWith("reassigned")
        ? "GET / HTTP/1.1\r\nHost: localhost\r\n\r\nGET /second HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
        : "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );
    await completed.promise;
    if (mode === "reassigned-informational") await reassigned.promise;
    await closed;
    if (mode === "headers-frozen") assert.match(Buffer.concat(chunks).toString(), /x-proof: before\r\n/i);
    if (mode === "strict-no-body" || mode === "bodyless-write") {
      const bytes = Buffer.concat(chunks).toString();
      assert.match(bytes, /^HTTP\/1.1 204 /);
      assert.equal(bytes.slice(bytes.indexOf("\r\n\r\n") + 4), "");
    } else if (!discardsResponse) {
      const bodies = parseResponses(Buffer.concat(chunks));
      if (mode.startsWith("reassigned"))
        assert.deepEqual(
          bodies.map(body => body.toString()),
          ["A", mode === "reassigned-no-body" ? "" : "BC"],
        );
      else if (mode === "pipeline") assert.deepEqual(bodies, [Buffer.alloc(4 * 1024 * 1024, 65)]);
      else if (mode === "high-water") assert.deepEqual(bodies, [Buffer.alloc(2048, 65)]);
      else if (mode === "strict-sequence" || mode === "strict-mutable-header")
        assert.deepEqual(bodies, [Buffer.from("ABCD")]);
      else if (mode === "raw-drain") {
        assert.equal(bodies[0].length, 16 * 1024 * 1024 + 2048);
        assert.deepEqual(bodies[0].subarray(0, 2048), Buffer.alloc(2048, 65));
        assert.deepEqual(bodies[0].subarray(2048), Buffer.alloc(16 * 1024 * 1024, 66));
      } else if (mode === "native-raw-drain" || mode === "native-queued") {
        assert.equal(bodies[0].length, 32 * 1024 * 1024 + (mode === "native-raw-drain" ? 1 : 0));
        assert.equal(bodies[0].subarray(-1).toString(), mode === "native-raw-drain" ? "B" : "A");
      } else if (mode === "interleaved" || mode === "after-uncork") {
        assert.equal(bodies[0].subarray(16 * 1024 * 1024).toString(), mode === "interleaved" ? "BCDE" : "CDE");
      } else
        assert.deepEqual(
          bodies.map(body => body.toString()),
          ["AB"],
        );
    }
  } finally {
    client?.destroy();
    first?.destroy();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(resolve));
  }
  console.log("ok");
}

if (import.meta.main) {
  await responseCorkOracle(process.argv[2] ?? "counts").catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
