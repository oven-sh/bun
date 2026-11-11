// A reader takes part of what 'readable' announced and leaves the rest to a listener that it adds afterwards.
// Node announces the rest again with the next chunk, as long as no more than highWaterMark bytes stayed behind:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/streams/readable.js#L842-L858
// A libuv stream gives Node at most 64 KiB a read, from the event loop, so that holds for every stream it feeds.
//
//   <runtime> readable-partial-read-fixture.js <directory for its files> <source>:<reader>...
//
// For each case the writer sends PAYLOAD bytes and keeps its end open. The fixture prints, as one line of JSON,
// what the reader had while that end was still open, and how the stream ended once the writer closed it.
const fs = require("node:fs");
const path = require("node:path");

// One byte and a header more than the mark: after read(8) more than the mark is left of a chunk that holds it all.
const HEADER = 8;
const PAYLOAD = 64 * 1024 + HEADER + 1;
const WARM_UP = 1024 * 1024;
const [, , dir, ...cases] = process.argv;

const turn = () => new Promise(resolve => setImmediate(resolve));
// What is in the kernel reaches the stream within a few turns of the loop. A stream that stalled never delivers it.
async function turnsUntil(done, limit = 400) {
  for (let i = 0; i < limit && !done(); i++) await turn();
}
const sleepCell = new Int32Array(new SharedArrayBuffer(4));
function waitForFile(file) {
  const deadline = Date.now() + 20_000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error("timed out waiting for " + file);
    Atomics.wait(sleepCell, 0, 0, 1);
  }
}

// Records the largest push of the source, and counts the pushes that arrive inside a _read() for a stream that
// holds bytes: they land on what a read(n) left behind before the stream can say that it is under its mark.
function watchPushes(stream, counts) {
  const { _read, push } = stream;
  let readingHeldBytes = 0;
  stream._read = function (size) {
    const held = this.readableLength > 0;
    if (held) readingHeldBytes++;
    try {
      return _read.call(this, size);
    } finally {
      if (held) readingHeldBytes--;
    }
  };
  stream.push = function (chunk, encoding) {
    if (chunk) {
      counts.largestPush = Math.max(counts.largestPush, chunk.length);
      if (readingHeldBytes > 0) counts.stackedPushes++;
    }
    return push.call(this, chunk, encoding);
  };
}

function readBody(stream, counts) {
  return () => {
    let chunk;
    while ((chunk = stream.read()) !== null) counts.received += chunk.length;
  };
}

const readers = {
  // The report: a listener for the header, which hands over to a listener for the body.
  swap(stream, counts) {
    const header = () => {
      const bytes = stream.read(HEADER);
      if (bytes === null) return;
      counts.headerCalls++;
      counts.received += bytes.length;
      stream.off("readable", header);
      stream.on("readable", readBody(stream, counts));
    };
    stream.on("readable", header);
  },
  once(stream, counts) {
    stream.once("readable", () => {
      const bytes = stream.read(HEADER);
      counts.headerCalls++;
      counts.received += bytes ? bytes.length : 0;
      stream.on("readable", readBody(stream, counts));
    });
  },
  // The header goes back, as in the parseHeader() example of the stream documentation.
  unshift(stream, counts) {
    const header = () => {
      const bytes = stream.read(HEADER);
      if (bytes === null) return;
      counts.headerCalls++;
      stream.off("readable", header);
      stream.unshift(bytes);
      stream.on("readable", readBody(stream, counts));
    };
    stream.on("readable", header);
  },
  // The hand-over waits for a promise job. The next chunk must not reach the header listener before it.
  awaitSwap(stream, counts) {
    const header = async () => {
      const bytes = stream.read(HEADER);
      if (bytes === null) return;
      counts.headerCalls++;
      counts.received += bytes.length;
      await null;
      stream.off("readable", header);
      stream.on("readable", readBody(stream, counts));
    };
    stream.on("readable", header);
  },
};

// An async iterator takes the first chunk and a listener takes the rest. It starts when the payload is there:
// what the stream then reads at once must not be announced to the iterator alone.
readers.iterateThenListen = async (stream, counts) => {
  counts.headerCalls++;
  for await (const chunk of stream.iterator({ destroyOnReturn: false })) {
    counts.received += chunk.length;
    break;
  }
  stream.on("readable", readBody(stream, counts));
};
readers.iterateThenListen.startsLate = true;

const newCounts = () => ({ received: 0, headerCalls: 0, largestPush: 0, stackedPushes: 0 });

// `written` resolves when the whole payload is in the kernel, `release` lets the writer close its end.
// A reader starts in an event, where the ticks of what it does come before its own promise jobs: in the caller's
// (`inEvent`), which must not be a promise job, or in one of its own.
async function run(stream, reader, written, release, inEvent = false) {
  const counts = newCounts();
  watchPushes(stream, counts);
  let ended = false;
  stream.on("end", () => (ended = true));
  const start = readers[reader];
  if (inEvent) {
    start(stream, counts);
  } else {
    if (start.startsLate) await written();
    await new Promise(resolve =>
      setImmediate(() => {
        start(stream, counts);
        resolve();
      }),
    );
  }
  if (inEvent || !start.startsLate) await written();
  await turnsUntil(() => counts.received >= PAYLOAD);
  const whileOpen = { ...counts, ended };
  release();
  await turnsUntil(() => ended, 1000);
  return { whileOpen, received: counts.received, ended };
}

// Writes the payload to `fd`, makes the marker, and keeps `fd` open until its stdin ends.
const writerArgs = (fd, marker) => [
  "/bin/sh",
  "-c",
  `head -c ${PAYLOAD} /dev/zero >&${fd}; : > "$0"; cat > /dev/null`,
  marker,
];
// Nothing is read before the payload is complete: the first read finds it all.
const writerIsDone = marker => async () => waitForFile(marker);

function fromChild(fd) {
  return (reader, marker) => {
    const { spawn } = require("node:child_process");
    const stdio = ["pipe", "inherit", "inherit"];
    stdio[fd] = "pipe";
    const [command, ...args] = writerArgs(fd, marker);
    const child = spawn(command, args, { stdio });
    return run(child.stdio[fd], reader, writerIsDone(marker), () => child.stdin.end());
  };
}

// Both ends in this process. The first megabyte flows, so that the kernel hands over the payload in one piece.
function overSocket(reader, listen, listenArgs, connect) {
  const { promise, resolve } = Promise.withResolvers();
  let client;
  const server = listen(async socket => {
    let warm = 0;
    const warmedUp = Promise.withResolvers();
    const onWarmUp = chunk => {
      warm += chunk.length;
      if (warm < WARM_UP) return;
      socket.off("data", onWarmUp);
      socket.pause();
      warmedUp.resolve();
    };
    socket.on("data", onWarmUp);
    client.write(Buffer.alloc(WARM_UP, "w"));
    await warmedUp.promise;
    const written = () => new Promise(done => client.write(Buffer.alloc(PAYLOAD, "a"), done));
    const result = await run(socket, reader, written, () => client.end());
    socket.destroy();
    server.close(() => resolve(result));
  });
  server.listen(...listenArgs, () => {
    client = connect(server);
    client.on("error", () => {});
    client.resume();
  });
  return promise;
}

const sources = {
  "child-stdout": fromChild(1),
  "child-stderr": fromChild(2),
  "child-stdio3": fromChild(3),
  "fromweb-spawn"(reader, marker) {
    const proc = Bun.spawn({ cmd: writerArgs(1, marker), stdio: ["pipe", "pipe", "inherit"], lazy: true });
    const stream = require("node:stream").Readable.fromWeb(proc.stdout);
    return run(stream, reader, writerIsDone(marker), () => proc.stdin.end());
  },
  tcp(reader) {
    const net = require("node:net");
    return overSocket(reader, net.createServer, [0, "127.0.0.1"], server =>
      net.connect(server.address().port, "127.0.0.1"),
    );
  },
  unix(reader, marker) {
    const net = require("node:net");
    const socketPath = marker + ".sock";
    return overSocket(reader, net.createServer, [socketPath], () => net.connect(socketPath));
  },
  tls(reader) {
    const tls = require("node:tls");
    const cert = fs.readFileSync(path.join(dir, "cert.pem"));
    const key = fs.readFileSync(path.join(dir, "key.pem"));
    return overSocket(
      reader,
      onSocket => tls.createServer({ cert, key }, onSocket),
      [0, "127.0.0.1"],
      server => tls.connect({ port: server.address().port, host: "127.0.0.1", ca: cert, servername: "localhost" }),
    );
  },
  // The second request of a connection, whose first one made the kernel's window grow. Its body stays one byte short.
  "http-request"(reader) {
    const http = require("node:http");
    const net = require("node:net");
    const { promise, resolve } = Promise.withResolvers();
    let client;
    const server = http.createServer(async (req, res) => {
      if (req.url === "/warm-up") {
        req.resume().on("end", () => res.end("ok"));
        return;
      }
      // Its head and PAYLOAD bytes of its body came in one write.
      const result = await run(
        req,
        reader,
        async () => {},
        () => client.write("z"),
        true,
      );
      res.end("ok");
      client.destroy();
      server.close(() => resolve(result));
    });
    server.listen(0, "127.0.0.1", () => {
      client = net.connect(server.address().port, "127.0.0.1");
      client.once("data", () => {
        const head = `POST /upload HTTP/1.1\r\nHost: a\r\nContent-Length: ${PAYLOAD + 1}\r\n\r\n`;
        client.write(Buffer.concat([Buffer.from(head), Buffer.alloc(PAYLOAD, "a")]));
      });
      client.write(`POST /warm-up HTTP/1.1\r\nHost: a\r\nContent-Length: ${WARM_UP}\r\n\r\n`);
      client.write(Buffer.alloc(WARM_UP, "w"));
    });
    return promise;
  },
  // The same for the second response of a connection.
  "http-response"(reader) {
    const http = require("node:http");
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const { promise, resolve } = Promise.withResolvers();
    const written = Promise.withResolvers();
    let held;
    const server = http.createServer((req, res) => {
      if (req.url === "/warm-up") return res.end(Buffer.alloc(WARM_UP, "w"));
      held = res;
      res.writeHead(200, { "content-length": PAYLOAD + 1 });
      res.write(Buffer.alloc(PAYLOAD, "a"), written.resolve);
    });
    server.listen(0, "127.0.0.1", () => {
      const options = { agent, host: "127.0.0.1", port: server.address().port };
      http.get({ ...options, path: "/warm-up" }, warmUp => {
        warmUp.resume().on("end", () => {
          http.get({ ...options, path: "/download" }, async res => {
            const result = await run(
              res,
              reader,
              () => written.promise,
              () => held.end("z"),
              true,
            );
            agent.destroy();
            server.close(() => resolve(result));
          });
        });
      });
    });
    return promise;
  },
  // Redirected from a file by the test: no writer holds an end open. The process runs out of work at the end of
  // the file, or where the stream stalled.
  stdin(reader) {
    const counts = newCounts();
    watchPushes(process.stdin, counts);
    let ended = false;
    process.stdin.on("end", () => (ended = true));
    readers[reader](process.stdin, counts);
    return new Promise(resolve => process.on("beforeExit", () => resolve({ ...counts, ended })));
  },
};

(async () => {
  for (const [index, name] of cases.entries()) {
    const [source, reader] = name.split(":");
    const result = await sources[source](reader, path.join(dir, "written-" + index));
    console.log(JSON.stringify({ [name]: result }));
  }
})();
