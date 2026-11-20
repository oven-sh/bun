process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const http = require("http");

const asyncLocalStorage = new AsyncLocalStorage();
const store = () => asyncLocalStorage.getStore() ?? "-";
let failed = false;

async function row(name, expected, body) {
  const seen = [];
  await body(seen);
  // The number of chunks is not the point: fold a run of equal entries into one.
  const actual = seen.filter((entry, i) => entry !== seen[i - 1]).join(" ");
  if (actual !== expected) {
    console.error(`FAIL: ${name}: expected "${expected}", got "${actual}"`);
    failed = true;
  }
}

// The server sends the next piece only after the client took the one before, and ends the body only after the
// client took the last piece. So the body never arrives whole, and its end arrives alone.
let clientTookPiece = () => {};
const server = http.createServer(async (req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  for (let i = 0; i < 3; i++) {
    const taken = new Promise(resolve => (clientTookPiece = resolve));
    res.write("piece " + i);
    await taken;
  }
  res.end();
});

function recordingSink(seen, name = "") {
  return new WritableStream({
    write() {
      seen.push(name + "write:" + store());
      clientTookPiece();
    },
    close() {
      seen.push(name + "close:" + store());
    },
  });
}

async function drain(stream) {
  const reader = stream.getReader();
  while (!(await reader.read()).done) clientTookPiece();
}

server.listen(0, "127.0.0.1", async () => {
  const url = `http://127.0.0.1:${server.address().port}/`;

  await row("fetch().body.pipeTo(sink)", "write:u1 close:u1", async seen => {
    await asyncLocalStorage.run("u1", async () => {
      await (await fetch(url)).body.pipeTo(recordingSink(seen));
    });
  });

  await row("fetch().body.pipeThrough(new TextDecoderStream()).pipeTo(sink)", "write:u1 close:u1", async seen => {
    await asyncLocalStorage.run("u1", async () => {
      await (await fetch(url)).body.pipeThrough(new TextDecoderStream()).pipeTo(recordingSink(seen));
    });
  });

  await row("fetch().body.pipeThrough(transform with flush())", "transform:u1 flush:u1", async seen => {
    await asyncLocalStorage.run("u1", async () => {
      const transform = new TransformStream({
        transform(chunk, controller) {
          seen.push("transform:" + store());
          controller.enqueue(chunk);
        },
        flush() {
          seen.push("flush:" + store());
        },
      });
      await drain((await fetch(url)).body.pipeThrough(transform));
    });
  });

  // The code that called tee() drives the reads of the body, in its own store. That store is not the store of the pipe.
  await row("close() of a pipe made outside any store, from a tee() made inside a store", "close:-", async seen => {
    const response = await fetch(url);
    const [a, b] = asyncLocalStorage.run("u9", () => response.body.tee());
    // Lets both branches start, and do their first read of the body, in u9.
    await new Promise(resolve => setImmediate(resolve));
    const sink = new WritableStream({
      write() {
        clientTookPiece();
      },
      close() {
        seen.push("close:" + store());
      },
    });
    await Promise.all([a.pipeTo(sink), drain(b)]);
  });

  await row("a source that holds its chunks, piped to a sink with highWaterMark 8", "write:u1 close:u1", async seen => {
    const source = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(i);
        controller.close();
      },
    });
    const sink = new WritableStream(
      {
        write() {
          seen.push("write:" + store());
        },
        close() {
          seen.push("close:" + store());
        },
      },
      { highWaterMark: 8 },
    );
    await new Promise(resolve => setImmediate(resolve));
    await asyncLocalStorage.run("u1", () => source.pipeTo(sink));
  });

  server.close();
  process.exit(failed ? 1 : 0);
});
