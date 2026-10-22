// respondWithFD() and respondWithFile() on a server, one request per case. Runs under bun and under node.
// Prints one JSON line per case: what the call did on the server, then what the client saw.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import http2 from "node:http2";
import path from "node:path";

// An empty directory for the files of this run. The test makes it and removes it.
const dir = process.argv[2];
const ten = path.join(dir, "ten.txt");
const empty = path.join(dir, "empty.txt");
const big = path.join(dir, "big.bin");
const missing = path.join(dir, "missing.txt");
fs.writeFileSync(ten, "0123456789");
fs.writeFileSync(empty, "");
// 200000 bytes is four reads of 64 KiB. No two of them are equal.
const bigContent = Buffer.alloc(200000);
for (let i = 0; i < bigContent.length; i++) bigContent[i] = 97 + ((i * 7 + (i >> 10)) % 26);
fs.writeFileSync(big, bigContent);
// No open descriptor has this number, and none gets it while a case runs.
const badFd = 2 ** 30;
// One descriptor for every range. Only a negative offset reads from its own position, so that position is
// moved off 0 first: a read from it cannot pass for a read at offset 0.
const positioned = fs.openSync(ten, "r");
fs.readSync(positioned, Buffer.alloc(4), 0, 4, null);
const trailers = { "x-trailer": "sent" };
const handleCloses = [];

// One case expects an uncaught exception. Any other one ends the run.
let onExpectedUncaught;
process.on("uncaughtException", err => {
  const expected = onExpectedUncaught;
  onExpectedUncaught = undefined;
  if (expected) return expected(err);
  console.log(JSON.stringify({ uncaughtException: err.code ?? err.message }));
  process.exit(1);
});

// A descriptor for this response only, closed where node's documentation closes it.
function open(stream, file) {
  const fd = fs.openSync(file, "r");
  stream.on("close", () => fs.closeSync(fd));
  return fd;
}
const bigFd = options => stream => stream.respondWithFD(open(stream, big), {}, options);
const file = (name, options) => stream => stream.respondWithFile(name, {}, options);
// A statCheck that counts its calls, for the cases where it must not run.
const counted = log => {
  log.statCheckCalls = 0;
  return () => void log.statCheckCalls++;
};
// A statCheck that cancels sends nothing. The case then answers by itself, so that the request ends.
function cancel() {
  setImmediate(() => {
    this.respond({ ":status": 418 });
    this.end();
  });
  return false;
}
// A statCheck that closes the stream. Nothing may be sent after it.
function refuse() {
  this.close(http2.constants.NGHTTP2_REFUSED_STREAM);
}
// What a second response on the stream does, after respondWithFD() has returned.
const then = again => (stream, log) => {
  const fd = open(stream, ten);
  stream.respondWithFD(fd);
  try {
    again(stream, fd);
    log.then = "no throw";
  } catch (err) {
    log.then = err.code;
  }
};
// The stream goes away right after the call, with fstat or the first read still pending.
const teardown = (call, end) => (stream, log) => {
  call(stream, log);
  stream[end]();
};

const cases = {};
for (const [name, range] of [
  ["no options", {}],
  ["offset 0", { offset: 0 }],
  ["offset 3", { offset: 3 }],
  ["offset 3, length 4", { offset: 3, length: 4 }],
  ["offset 3, length 100", { offset: 3, length: 100 }],
  ["offset 3, length MAX_SAFE_INTEGER", { offset: 3, length: Number.MAX_SAFE_INTEGER }],
  ["length 0", { length: 0 }],
  ["length -5", { length: -5 }],
  ["length 2.5", { length: 2.5 }],
  ["length NaN", { length: NaN }],
  ["offset 1.5", { offset: 1.5 }],
  ["offset NaN", { offset: NaN }],
  ["offset 100", { offset: 100 }],
]) {
  cases[`respondWithFD, ${name}`] = stream => stream.respondWithFD(positioned, {}, range);
  // statCheck gets { offset, length } as its third argument.
  cases[`respondWithFD, ${name}, statCheck`] = (stream, log) =>
    stream.respondWithFD(positioned, {}, {
      ...range,
      statCheck(stat, headers, statOptions) {
        log.statCheck = [arguments.length, { ...statOptions }];
      },
    });
}
Object.assign(cases, {
  "respondWithFD, statCheck sets the range": stream =>
    stream.respondWithFD(positioned, {}, {
      statCheck(stat, headers, statOptions) {
        statOptions.offset = 5;
        statOptions.length = 2;
      },
    }),
  "respondWithFD, statCheck sets length 2 ** 40": stream =>
    stream.respondWithFD(positioned, {}, {
      statCheck(stat, headers, statOptions) {
        statOptions.length = 2 ** 40;
      },
    }),
  "respondWithFD, statCheck sets a BigInt offset": (stream, log) => {
    // The TypeError leaves the fstat callback. Nothing was sent, so the case answers by itself.
    onExpectedUncaught = err => {
      log.uncaught = err.name;
      stream.respond({ ":status": 500 });
      stream.end();
    };
    stream.respondWithFD(positioned, {}, {
      statCheck(stat, headers, statOptions) {
        statOptions.offset = 5n;
      },
    });
  },
  // The descriptor is still at 4. These three read from there and leave it at EOF.
  "respondWithFD, offset -1, length 3": stream => stream.respondWithFD(positioned, {}, { offset: -1, length: 3 }),
  "respondWithFD, offset -1, statCheck": stream =>
    stream.respondWithFD(positioned, {}, { offset: -1, statCheck() {} }),
  "respondWithFD, offset -7": stream => stream.respondWithFD(positioned, {}, { offset: -7 }),

  "respondWithFD, statCheck sets content-length": stream =>
    stream.respondWithFD(open(stream, ten), {}, {
      statCheck(stat, headers) {
        headers["content-length"] = stat.size;
      },
    }),
  "respondWithFD, statCheck returns false": stream =>
    stream.respondWithFD(open(stream, ten), {}, { statCheck: cancel }),
  "respondWithFD, statCheck responds": stream =>
    stream.respondWithFD(open(stream, ten), {}, {
      statCheck() {
        this.respond({ ":status": 204 });
        this.end();
      },
    }),
  "respondWithFD, statCheck closes the stream": stream =>
    stream.respondWithFD(open(stream, ten), {}, { statCheck: refuse }),
  "respondWithFD, waitForTrailers": stream => {
    stream.on("wantTrailers", () => stream.sendTrailers(trailers));
    stream.respondWithFD(open(stream, ten), {}, { waitForTrailers: true });
  },
  "respondWithFD, length 0, then a 'wantTrailers' listener": stream => {
    stream.respondWithFD(open(stream, ten), {}, { length: 0, waitForTrailers: true });
    stream.on("wantTrailers", () => stream.sendTrailers(trailers));
  },
  "respondWithFD, with headers": stream =>
    stream.respondWithFD(open(stream, ten), { "content-type": "text/plain", "content-length": 10 }),
  "respondWithFD, status 204": stream => stream.respondWithFD(open(stream, ten), { ":status": 204 }),
  "respondWithFD, request pseudo-header": stream => stream.respondWithFD(open(stream, ten), { ":path": "/" }),
  "respondWithFD, bad descriptor": stream => stream.respondWithFD(badFd),
  "respondWithFD, bad descriptor, onError": (stream, log) =>
    stream.respondWithFD(badFd, {}, { onError: err => (log.onError = err.code) }),
  "respondWithFD, bad descriptor, statCheck": (stream, log) =>
    stream.respondWithFD(badFd, {}, { statCheck: counted(log) }),
  "respondWithFD, -1": stream => stream.respondWithFD(-1),
  "respondWithFD, FileHandle": async stream => {
    const handle = await fsPromises.open(ten, "r");
    stream.on("close", () => handleCloses.push(handle.close()));
    stream.respondWithFD(handle);
  },
  "respondWithFD, closed FileHandle": async (stream, log) => {
    const handle = await fsPromises.open(ten, "r");
    await handle.close();
    stream.respondWithFD(handle);
    log.closed = stream.closed;
  },
  "respondWithFD, 200000 bytes": bigFd(),
  "respondWithFD, 200000 bytes, statCheck": bigFd({ statCheck() {} }),
  "respondWithFD, 200000 bytes, offset -1": bigFd({ offset: -1 }),
  "respondWithFD, 200000 bytes, offset 70000, length 100000": bigFd({ offset: 70000, length: 100000 }),
  "respondWithFD, 200000 bytes, length 65536": bigFd({ length: 65536 }),
  "respondWithFD, 200000 bytes, length 65537": bigFd({ length: 65537 }),
  "respondWithFD, then respond()": then(stream => stream.respond({ ":status": 201 })),
  "respondWithFD, then respondWithFD()": then((stream, fd) => stream.respondWithFD(fd)),
  "respondWithFD, then respondWithFile()": then(stream => stream.respondWithFile(ten)),
  "respondWithFD, then end()": then(stream => stream.end()),
  "close(), then respondWithFD": stream => {
    stream.close();
    stream.respondWithFD(open(stream, ten));
  },
  "close(), then respondWithFD, statCheck": stream => {
    stream.close();
    stream.respondWithFD(open(stream, ten), {}, { statCheck() {} });
  },
  "respondWithFD, bad descriptor, then destroy()": teardown(stream => stream.respondWithFD(badFd), "destroy"),
  "respondWithFD, bad descriptor, then close()": teardown(stream => stream.respondWithFD(badFd), "close"),
  "respondWithFD, bad descriptor, statCheck, then destroy()": teardown(
    (stream, log) => stream.respondWithFD(badFd, {}, { statCheck: counted(log) }),
    "destroy",
  ),
  "respondWithFD, bad descriptor, statCheck, then close()": teardown(
    (stream, log) => stream.respondWithFD(badFd, {}, { statCheck: counted(log) }),
    "close",
  ),
  "respondWithFD, statCheck, then destroy()": teardown(
    (stream, log) => stream.respondWithFD(open(stream, ten), {}, { statCheck: counted(log) }),
    "destroy",
  ),
  "respondWithFD, statCheck, then close()": teardown(
    (stream, log) => stream.respondWithFD(open(stream, ten), {}, { statCheck: counted(log) }),
    "close",
  ),

  "respondWithFile": file(ten),
  "respondWithFile, offset 2, length 3": file(ten, { offset: 2, length: 3 }),
  "respondWithFile, length 0": file(ten, { length: 0 }),
  "respondWithFile, offset 4, length 0": file(ten, { offset: 4, length: 0 }),
  "respondWithFile, offset -5": file(ten, { offset: -5 }),
  "respondWithFile, offset 10": file(ten, { offset: 10 }),
  "respondWithFile, length 2 ** 40": file(ten, { length: 2 ** 40 }),
  "respondWithFile, empty file": file(empty),
  "respondWithFile, statCheck returns false": file(ten, { statCheck: cancel }),
  "respondWithFile, statCheck closes the stream": file(ten, { statCheck: refuse }),
  "respondWithFile, statCheck sets a header": file(ten, {
    statCheck(stat, headers) {
      headers["x-size"] = stat.size;
    },
  }),
  "respondWithFile, statCheck arguments": (stream, log) =>
    stream.respondWithFile(ten, {}, {
      statCheck() {
        log.statCheck = [arguments.length];
      },
    }),
  "respondWithFile, waitForTrailers": stream => {
    stream.on("wantTrailers", () => stream.sendTrailers(trailers));
    stream.respondWithFile(ten, {}, { waitForTrailers: true });
  },
  "respondWithFile, 200000 bytes": file(big),
  "respondWithFile, 200000 bytes, offset 70000, length 100000": file(big, { offset: 70000, length: 100000 }),
  "respondWithFile, missing file": file(missing),
  "respondWithFile, missing file, onError": (stream, log) =>
    stream.respondWithFile(missing, {}, {
      onError(err) {
        log.onError = err.code;
        stream.respond({ ":status": 404 });
        stream.end();
      },
    }),
  "respondWithFile, directory": file(dir),
  "respondWithFile, directory, onError": (stream, log) =>
    stream.respondWithFile(dir, {}, {
      onError(err) {
        log.onError = err.code;
        stream.respond({ ":status": 500 });
        stream.end();
      },
    }),
  "respondWithFile, then respond()": stream => {
    stream.respondWithFile(ten);
    stream.respond({ ":status": 201 });
    stream.end("second");
  },
  "close(), then respondWithFile": stream => {
    stream.close();
    stream.respondWithFile(ten);
  },
  "respondWithFile, statCheck, then destroy()": teardown(
    (stream, log) => stream.respondWithFile(ten, {}, { statCheck: counted(log) }),
    "destroy",
  ),
  "respondWithFile, statCheck, then close()": teardown(
    (stream, log) => stream.respondWithFile(ten, {}, { statCheck: counted(log) }),
    "close",
  ),
  "respondWithFile, directory, then destroy()": teardown(file(dir), "destroy"),
  "respondWithFile, directory, then close()": teardown(file(dir), "close"),
  // The session is in order after the cases that tore a stream down: it still answers.
  "respondWithFD, after every other case": stream => stream.respondWithFD(open(stream, ten)),
});
// Windows is left out here: the test does not depend on what a read of a directory handle gives there.
if (process.platform !== "win32") {
  cases["respondWithFD, directory"] = stream => stream.respondWithFD(open(stream, dir));
  cases["respondWithFD, directory, statCheck"] = (stream, log) =>
    stream.respondWithFD(open(stream, dir), {}, { statCheck: counted(log) });
}
if (process.platform === "linux") {
  // A file in /proc is a regular file of size 0 that has content. Only respondWithFile() goes by the size.
  const procFile = "/proc/sys/kernel/ostype";
  cases["respondWithFD, /proc file"] = stream => stream.respondWithFD(open(stream, procFile));
  cases["respondWithFD, /proc file, statCheck"] = stream =>
    stream.respondWithFD(open(stream, procFile), {}, { statCheck() {} });
  cases["respondWithFile, /proc file"] = file(procFile);

  // A FIFO that holds ten bytes and has no writer left: a read gives the bytes, and the next one EOF.
  let fifos = 0;
  const fifo = options => stream => {
    const name = path.join(dir, `fifo-${fifos++}`);
    execFileSync("mkfifo", [name]);
    const fd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const writer = fs.openSync(name, "w");
    fs.writeSync(writer, "0123456789");
    fs.closeSync(writer);
    stream.on("close", () => fs.closeSync(fd));
    stream.respondWithFD(fd, {}, options);
  };
  cases["respondWithFD, FIFO"] = fifo();
  cases["respondWithFD, FIFO, statCheck"] = fifo({ statCheck() {} });
  cases["respondWithFD, FIFO, length 4"] = fifo({ length: 4 });
  cases["respondWithFD, FIFO, offset -1"] = fifo({ offset: -1 });
  cases["respondWithFD, FIFO, offset 2"] = fifo({ offset: 2 });
}

const names = Object.keys(cases);
const logs = new Map();
const server = http2.createServer();
server.on("stream", async (stream, headers) => {
  const name = names[headers[":path"].slice(1)];
  const log = {};
  const { promise: closed, resolve: onClosed } = Promise.withResolvers();
  logs.set(name, { log, closed });
  stream.on("error", err => (log.error = err.code));
  stream.on("close", onClosed);
  try {
    await cases[name](stream, log);
    log.headersSent = stream.headersSent;
  } catch (err) {
    log.threw = err.code;
    // Nothing was sent, so the case answers by itself.
    if (!stream.destroyed && !stream.closed && !stream.headersSent) {
      stream.respond({ ":status": 500 });
      stream.end();
    }
  }
});

function request(client, pathname) {
  return new Promise(resolve => {
    const req = client.request({ ":path": pathname });
    const seen = {};
    const chunks = [];
    req.on("response", headers => {
      seen.status = headers[":status"];
      for (const name of ["content-length", "content-type", "x-size"]) {
        if (headers[name] !== undefined) seen[name] = headers[name];
      }
    });
    req.on("trailers", headers => (seen.trailers = headers["x-trailer"]));
    req.on("data", chunk => chunks.push(chunk));
    req.on("error", err => (seen.error = err.message));
    req.on("close", () => {
      const body = Buffer.concat(chunks);
      // A long body prints as its length and the start of its hash.
      seen.body =
        body.length <= 16
          ? body.toString()
          : `${body.length} bytes, sha1 ${crypto.createHash("sha1").update(body).digest("hex").slice(0, 12)}`;
      resolve(seen);
    });
  });
}

server.listen(0, "127.0.0.1", async () => {
  const client = http2.connect(`http://127.0.0.1:${server.address().port}`);
  client.on("error", () => {});
  for (let i = 0; i < names.length; i++) {
    const seen = await request(client, `/${i}`);
    const { log, closed } = logs.get(names[i]);
    await closed;
    console.log(JSON.stringify({ case: names[i], server: log, client: seen }));
  }
  client.close();
  server.close();
  fs.closeSync(positioned);
  await Promise.all(handleCloses);
});
