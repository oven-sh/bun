// A reader takes part of what 'readable' announced and leaves the rest to a listener that it adds afterwards.
// Node announces the rest again with the next chunk, as long as no more than highWaterMark bytes stayed behind:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/streams/readable.js#L842-L858
// A libuv stream gives Node at most 64 KiB a read, from the event loop, so that holds for every stream it feeds.
//
// readInPart(dir, source, reader) has the writer of `source` send PAYLOAD bytes and keep its end open. It resolves
// to what `reader` had while that end was still open, and how the stream ended once the writer closed it.
// Run as a program, it prints that as one line of JSON for each case:
//
//   <runtime> readable-partial-read-fixture.js <directory for its files> <source>:<reader>[:<size>]...
const fs = require("node:fs");
const path = require("node:path");

// One byte and a header more than the mark: after read(8) more than the mark is left of a chunk that holds it all.
const HEADER = 8;
const PAYLOAD = 64 * 1024 + HEADER + 1;
const WARM_UP = 1024 * 1024;

let files = 0;
const newFile = dir => path.join(dir, `f${process.pid}.${files++}`);

const turn = () => new Promise(resolve => setImmediate(resolve));

const sleepCell = new Int32Array(new SharedArrayBuffer(4));
// Keeps the loop from turning until the writer has made `file`, or cannot be expected to any more.
function waitForFile(file) {
  const deadline = Date.now() + 2000;
  while (!fs.existsSync(file) && Date.now() < deadline) Atomics.wait(sleepCell, 0, 0, 1);
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
  // The same, and a read(0) behind the hand-over.
  swapThenRead0(stream, counts) {
    const header = () => {
      const bytes = stream.read(HEADER);
      if (bytes === null) return;
      counts.headerCalls++;
      counts.received += bytes.length;
      stream.off("readable", header);
      stream.on("readable", readBody(stream, counts));
      stream.read(0);
    };
    stream.on("readable", header);
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

// The header is read with no listener, when the payload is there, and a listener takes the rest a promise job later.
readers.readThenListen = async (stream, counts) => {
  counts.headerCalls++;
  const bytes = stream.read(HEADER);
  counts.received += bytes ? bytes.length : 0;
  await null;
  stream.on("readable", readBody(stream, counts));
};
readers.readThenListen.startsLate = true;

const newCounts = () => ({ received: 0, headerCalls: 0, largestPush: 0, stackedPushes: 0 });

// `written` resolves when the writer has sent what it can of its `size` bytes, `release` lets it close its end.
// A reader starts in an event, where the ticks of what it does come before its own promise jobs: in the caller's
// (`inEvent`), which must not be a promise job, or in one of its own.
async function run(stream, reader, written, release, { inEvent = false, size = PAYLOAD } = {}) {
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
  // By the end of a turn of the loop every 'readable' that was due has been emitted, and these readers read only
  // when they are told. So nothing more comes of a stream that then has no _read() outstanding, or that already
  // holds all that one could bring.
  const state = stream._readableState;
  const allArrived = () => counts.received + state.length >= size;
  do await turn();
  while (counts.received < size && state.reading && !allArrived());
  const whileOpen = { ...counts, ended };
  release();
  do await turn();
  while (!ended && state.reading);
  return { whileOpen, received: counts.received, ended };
}

// Writes `size` bytes to `fd`, makes the marker, and keeps `fd` open until its stdin ends.
const writerArgs = (fd, marker, size) => [
  "sh",
  "-c",
  `head -c ${size} /dev/zero >&${fd}; : > "$0"; cat > /dev/null`,
  marker,
];
// The kernel holds PAYLOAD bytes for a reader that has not read yet: nothing is read before they are complete, and
// the first read finds them all. The writer of more is still writing when the reader starts, as in the report.
const writerIsDone = (marker, size) => async () => {
  if (size <= PAYLOAD) waitForFile(marker);
};

function fromChild(fd) {
  return (reader, dir, size = PAYLOAD) => {
    const { spawn } = require("node:child_process");
    const marker = newFile(dir);
    const stdio = ["pipe", "ignore", "ignore"];
    stdio[fd] = "pipe";
    const [command, ...args] = writerArgs(fd, marker, size);
    const child = spawn(command, args, { stdio });
    const stream = child.stdio[fd];
    // A writer that a stalled reader left blocked sees its descriptor close.
    return run(stream, reader, writerIsDone(marker, size), () => child.stdin.end(), { size }).finally(() =>
      stream.destroy(),
    );
  };
}

const tlsOptions = dir => ({
  cert: fs.readFileSync(path.join(dir, "cert.pem")),
  key: fs.readFileSync(path.join(dir, "key.pem")),
});
const tlsConnect = (server, { cert }) =>
  require("node:tls").connect({ port: server.address().port, host: "127.0.0.1", ca: cert, servername: "localhost" });
const tcpConnect = server => require("node:net").connect(server.address().port, "127.0.0.1");

// Both ends of `stream` are in this process. The first megabyte flows, so that the kernel hands over the payload in
// one piece.
async function afterWarmUp(stream, writer, reader) {
  let warm = 0;
  const warmedUp = Promise.withResolvers();
  const onWarmUp = chunk => {
    warm += chunk.length;
    if (warm < WARM_UP) return;
    stream.off("data", onWarmUp);
    stream.pause();
    warmedUp.resolve();
  };
  stream.on("data", onWarmUp);
  writer.write(Buffer.alloc(WARM_UP, "w"));
  await warmedUp.promise;
  const written = () => new Promise(done => writer.write(Buffer.alloc(PAYLOAD, "a"), done));
  const result = await run(stream, reader, written, () => writer.end());
  stream.destroy();
  writer.destroy();
  return result;
}

// The reader has the socket that the server accepted, or the one that connected (`readsConnected`).
function overSocket(reader, listen, listenArgs, connect, readsConnected = false) {
  const { promise, resolve } = Promise.withResolvers();
  let connected;
  const server = listen(async accepted => {
    const [stream, writer] = readsConnected ? [connected, accepted] : [accepted, connected];
    writer.on("error", () => {});
    writer.resume();
    const result = await afterWarmUp(stream, writer, reader);
    server.close(() => resolve(result));
  });
  server.listen(...listenArgs, () => {
    connected = connect(server);
    connected.on("error", () => {});
  });
  return promise;
}

const overTCP = readsConnected => reader =>
  overSocket(reader, require("node:net").createServer, [0, "127.0.0.1"], tcpConnect, readsConnected);

const overTLS = readsConnected => (reader, dir) => {
  const options = tlsOptions(dir);
  const listen = onSocket => require("node:tls").createServer(options, onSocket);
  return overSocket(reader, listen, [0, "127.0.0.1"], server => tlsConnect(server, options), readsConnected);
};

// The second request of a connection, whose first one made the kernel's window grow. Its body stays one byte short.
const httpRequest = secure => (reader, dir) => {
  const options = secure ? tlsOptions(dir) : {};
  const { promise, resolve } = Promise.withResolvers();
  let client;
  const server = require(secure ? "node:https" : "node:http").createServer(options, async (req, res) => {
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
      { inEvent: true },
    );
    res.end("ok");
    client.destroy();
    server.close(() => resolve(result));
  });
  server.listen(0, "127.0.0.1", () => {
    client = secure ? tlsConnect(server, options) : tcpConnect(server);
    client.on("error", () => {});
    client.once("data", () => {
      const head = `POST /upload HTTP/1.1\r\nHost: a\r\nContent-Length: ${PAYLOAD + 1}\r\n\r\n`;
      client.write(Buffer.concat([Buffer.from(head), Buffer.alloc(PAYLOAD, "a")]));
    });
    client.write(`POST /warm-up HTTP/1.1\r\nHost: a\r\nContent-Length: ${WARM_UP}\r\n\r\n`);
    client.write(Buffer.alloc(WARM_UP, "w"));
  });
  return promise;
};

const sources = {
  "child-stdout": fromChild(1),
  "child-stderr": fromChild(2),
  "child-stdio3": fromChild(3),
  "fromweb-spawn"(reader, dir) {
    const marker = newFile(dir);
    const cmd = writerArgs(1, marker, PAYLOAD);
    const proc = Bun.spawn({ cmd, stdio: ["pipe", "pipe", "ignore"], lazy: true });
    const stream = require("node:stream").Readable.fromWeb(proc.stdout);
    return run(stream, reader, writerIsDone(marker, PAYLOAD), () => proc.stdin.end());
  },
  "tcp-accepted": overTCP(false),
  "tcp-connected": overTCP(true),
  "unix-accepted"(reader, dir) {
    const net = require("node:net");
    const socketPath = newFile(dir);
    return overSocket(reader, net.createServer, [socketPath], () => net.connect(socketPath));
  },
  "tls-accepted": overTLS(false),
  "tls-connected": overTLS(true),
  // The writer sends records of 10,000 bytes: what one read decrypts does not end where a record ends.
  "tls-small-records"(reader, dir) {
    const options = tlsOptions(dir);
    const listen = onSocket => require("node:tls").createServer(options, onSocket);
    const connect = server => {
      const socket = tlsConnect(server, options);
      socket.once("secureConnect", () => socket.setMaxSendFragment(10_000));
      return socket;
    };
    return overSocket(reader, listen, [0, "127.0.0.1"], connect);
  },
  // TLS starts on a socket that is connected already.
  "tls-over-socket"(reader, dir) {
    const options = tlsOptions(dir);
    const listen = onSocket => require("node:tls").createServer(options, onSocket);
    const connect = server =>
      require("node:tls").connect({ socket: tcpConnect(server), ca: options.cert, servername: "localhost" });
    return overSocket(reader, listen, [0, "127.0.0.1"], connect, true);
  },
  "http-request": httpRequest(false),
  "https-request": httpRequest(true),
  // The socket of an 'upgrade' event, which takes what the client sends behind the head of its request.
  "http-upgrade"(reader) {
    const { promise, resolve } = Promise.withResolvers();
    let client;
    const server = require("node:http").createServer();
    server.on("upgrade", async (req, socket) => {
      socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: raw\r\n\r\n");
      const result = await afterWarmUp(socket, client, reader);
      server.close(() => resolve(result));
    });
    server.listen(0, "127.0.0.1", () => {
      client = tcpConnect(server);
      client.on("error", () => {});
      client.resume();
      client.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: raw\r\n\r\n");
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
              { inEvent: true },
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

const readInPart = (dir, source, reader, size) => sources[source](reader, dir, size);

module.exports = { PAYLOAD, readInPart };

if (require.main === module) {
  const [, , dir, ...cases] = process.argv;
  (async () => {
    for (const name of cases) {
      const [source, reader, size] = name.split(":");
      console.log(JSON.stringify({ [name]: await readInPart(dir, source, reader, size && Number(size)) }));
    }
  })();
}
