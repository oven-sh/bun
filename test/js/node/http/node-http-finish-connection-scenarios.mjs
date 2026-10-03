// When a response finishes, the server does its connection step on the socket: it closes the
// connection or arms the keep-alive timeout, then takes the next response. The request's
// socket property and the response's socket property are public, so user code (and the
// stream destroyer, which sets req.socket to null) can empty or replace them before that.
//
// Each scenario is one server and one connection, and resolves with a row: the status codes
// the client read and the events of the response. node-http.test.ts has the expected rows.
//
// usage: <runtime> node-http-finish-connection-scenarios.mjs [directory for the unix socket]
// Run directly, it prints the rows and the uncaught exceptions as one JSON object.
// node v26.3.0 prints the same rows, without the ones that only Bun can send.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { compose, destroy, Duplex, PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import tls from "node:tls";

const keys = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");
const tlsOptions = {
  key: fs.readFileSync(path.join(keys, "agent1-key.pem")),
  cert: fs.readFileSync(path.join(keys, "agent1-cert.pem")),
};
const body = "hello";
const post = (url, headers = "") =>
  `POST ${url} HTTP/1.1\r\nHost: a\r\n${headers}Content-Length: ${body.length}\r\n\r\n${body}`;
const noop = () => {};

// Records the events of one response. Returns the callback for its end().
function watch(res, row) {
  const events = [];
  row.events.push(events);
  res.on("finish", () => events.push("finish"));
  res.on("close", () => events.push("close"));
  return () => events.push("end callback");
}

function answer(res, row) {
  res.statusCode = 401;
  res.end("no", watch(res, row));
}

// Every way to cut req.socket before the response ends.
const cuts = {
  "Readable.toWeb(req).cancel()": req => void Readable.toWeb(req).cancel(),
  "reader.cancel()": req => void Readable.toWeb(req).getReader().cancel(),
  "stream.destroy(req)": req => void destroy(req),
  "pipeline() with an aborted signal": req => {
    const controller = new AbortController();
    pipeline(req, new PassThrough(), { signal: controller.signal }).catch(noop);
    controller.abort();
  },
  "compose().destroy()": req => void compose(req, new PassThrough()).on("error", noop).destroy(),
  "Duplex.from(req).destroy()": req => void Duplex.from(req).on("error", noop).destroy(),
  "Readable.wrap(req).destroy()": req => void new Readable().wrap(req).on("error", noop).destroy(),
  "req.socket = null": req => void (req.socket = null),
  "req.socket = undefined": req => void (req.socket = undefined),
  "req.connection = null": req => void (req.connection = null),
  "req.socket = new net.Socket()": req => void (req.socket = new net.Socket()),
};
const cancel = cuts["Readable.toWeb(req).cancel()"];

function connect(server, transport) {
  const address = server.address();
  if (transport === "https") return tls.connect({ port: address.port, host: "127.0.0.1", rejectUnauthorized: false });
  if (transport === "unix") return net.connect(address);
  return net.connect(address.port, "127.0.0.1");
}

// Sends the requests one at a time, each after the previous response, and resolves with the
// status codes. "closed" follows them when the server closed the connection first.
function exchange(server, transport, requests) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const socket = connect(server, transport);
  const statuses = [];
  let buffered = "";
  let sent = 0;
  let settled = false;
  const settle = extra => {
    if (settled) return;
    settled = true;
    socket.destroy();
    // The events of the last response come in the turn that wrote it. This read is later.
    setImmediate(resolve, extra ? [...statuses, extra] : statuses);
  };
  socket.on("error", reject);
  socket.on(transport === "https" ? "secureConnect" : "connect", () => socket.write(requests[sent++]));
  socket.on("data", chunk => {
    buffered += chunk.toString("latin1");
    for (;;) {
      const headEnd = buffered.indexOf("\r\n\r\n");
      if (headEnd === -1) return;
      const head = buffered.slice(0, headEnd);
      let end;
      if (/^transfer-encoding: chunked$/im.test(head)) {
        const last = buffered.indexOf("0\r\n\r\n", headEnd + 4);
        if (last === -1) return;
        end = last + 5;
      } else {
        end = headEnd + 4 + Number(/^content-length: (\d+)$/im.exec(head)?.[1] ?? 0);
        if (buffered.length < end) return;
      }
      buffered = buffered.slice(end);
      const status = head.slice(9, 12);
      // An interim response does not answer the request.
      if (status === "100") continue;
      statuses.push(status);
      if (sent < requests.length) socket.write(requests[sent++]);
      else return settle();
    }
  });
  socket.on("close", () => settle("closed"));
  return promise;
}

// `first` answers the first request of the connection. The request after it gets a plain 200.
async function scenario({ transport = "http", options = {}, first, on = "request", configure, requests, socketDir }) {
  const row = { statuses: [], events: [] };
  const serverOptions = transport === "https" ? { ...tlsOptions, ...options } : options;
  const server = (transport === "https" ? https : http).createServer(serverOptions);
  let served = 0;
  server.on("request", (req, res) => {
    if (on === "request" && served++ === 0) return first(req, res, row);
    res.end("ok");
  });
  if (on !== "request") server.on(on, (req, res) => first(req, res, row));
  configure?.(server, row);
  await new Promise(resolve => {
    if (transport === "unix") server.listen(path.join(socketDir, `finish-connection-${process.pid}.sock`), resolve);
    else server.listen(0, "127.0.0.1", resolve);
  });
  try {
    row.statuses = await exchange(server, transport, requests ?? [post("/first"), post("/next")]);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  return row;
}

const later = callback => setImmediate(callback);

// name -> (directory for a unix socket) => row
export const scenarios = {};

// The response ends in the tick of the listener.
for (const [name, cut] of Object.entries(cuts)) {
  scenarios[`${name}, then end()`] = () =>
    scenario({
      first(req, res, row) {
        cut(req);
        answer(res, row);
      },
    });
}
scenarios["end(), then the cut in the same tick"] = () =>
  scenario({
    first(req, res, row) {
      answer(res, row);
      cancel(req);
    },
  });
scenarios["the cut in a tick queued before end()"] = () =>
  scenario({
    first(req, res, row) {
      process.nextTick(cancel, req);
      answer(res, row);
    },
  });
// A Windows named pipe is not a path in the temporary directory.
for (const transport of process.platform === "win32" ? ["https"] : ["https", "unix"]) {
  scenarios[`${transport}: the cut, then end()`] = socketDir =>
    scenario({
      transport,
      socketDir,
      first(req, res, row) {
        cancel(req);
        answer(res, row);
      },
    });
}
scenarios["a ServerResponse subclass: the cut, then end()"] = () =>
  scenario({
    options: { ServerResponse: class extends http.ServerResponse {} },
    first(req, res, row) {
      cancel(req);
      answer(res, row);
    },
  });
scenarios["a ServerResponse subclass with its own assignSocket(): the cut, then end()"] = () =>
  scenario({
    options: {
      ServerResponse: class extends http.ServerResponse {
        assignSocket(socket) {
          super.assignSocket(socket);
        }
      },
    },
    first(req, res, row) {
      cancel(req);
      answer(res, row);
    },
  });
scenarios["'checkContinue': the cut, then end()"] = () =>
  scenario({
    on: "checkContinue",
    requests: [post("/first", "Expect: 100-continue\r\n")],
    first(req, res, row) {
      cancel(req);
      answer(res, row);
    },
  });
scenarios["'checkExpectation': the cut, then end()"] = () =>
  scenario({
    on: "checkExpectation",
    requests: [post("/first", "Expect: something\r\n")],
    first(req, res, row) {
      cancel(req);
      answer(res, row);
    },
  });
scenarios["'dropRequest': the cut, then the server's 503"] = () =>
  scenario({
    requests: [post("/first"), post("/dropped")],
    configure(server) {
      server.maxRequestsPerSocket = 1;
      server.on("dropRequest", req => cancel(req));
    },
    first(req, res, row) {
      res.end("ok", watch(res, row));
    },
  });

// The response ends in a later tick, so it still has the connection then.
scenarios["the cut, then a later end()"] = () =>
  scenario({
    first(req, res, row) {
      cancel(req);
      later(() => answer(res, row));
    },
  });
scenarios["req.socket = new PassThrough(), then a later end()"] = () =>
  scenario({
    first(req, res, row) {
      req.socket = new PassThrough();
      later(() => answer(res, row));
    },
  });

// Bun writes a response through its own handle, so it also sends one whose socket property
// user code emptied or replaced. Node.js does not send that response.
if (process.versions.bun) {
  scenarios["res.socket = new PassThrough(), then a later end()"] = () =>
    scenario({
      first(req, res, row) {
        res.socket = new PassThrough();
        later(() => answer(res, row));
      },
    });
  scenarios["the cut, res.socket = null, then a later end()"] = () =>
    scenario({
      first(req, res, row) {
        cancel(req);
        res.socket = null;
        later(() => answer(res, row));
      },
    });
  // The socket of Node.js's net module has `server: null`.
  scenarios["res.socket = a socket with server: null, then a later end()"] = () =>
    scenario({
      first(req, res, row) {
        res.socket = Object.assign(new net.Socket(), { server: null });
        later(() => answer(res, row));
      },
    });
}

// The response has no connection left when it ends.
scenarios["res.emit('close'), then a later end()"] = () =>
  scenario({
    requests: [post("/first")],
    first(req, res, row) {
      const callback = watch(res, row);
      res.emit("close");
      later(() => res.end("late", callback));
    },
  });

// write() then end(): the high water mark of a response is the one of its server.
scenarios["write() and end(): writableHighWaterMark in 'finish'"] = () =>
  scenario({
    options: { highWaterMark: 1024 },
    first(req, res, row) {
      const callback = watch(res, row);
      res.on("finish", () => (row.highWaterMarkInFinish = res.writableHighWaterMark));
      res.write("a");
      res.end("b", callback);
    },
  });
scenarios["a write() over the high water mark, then end()"] = () =>
  scenario({
    options: { highWaterMark: 1024 },
    first(req, res, row) {
      const callback = watch(res, row);
      row.drains = 0;
      res.on("drain", () => row.drains++);
      row.write = res.write(Buffer.alloc(4096, "a"));
      res.end("b", callback);
    },
  });
scenarios["a write() over the high water mark, then end() at 'drain'"] = () =>
  scenario({
    options: { highWaterMark: 1024 },
    first(req, res, row) {
      const callback = watch(res, row);
      row.drains = 0;
      res.on("drain", () => {
        row.drains++;
        res.end("b", callback);
      });
      row.write = res.write(Buffer.alloc(4096, "a"));
    },
  });

if (import.meta.main) {
  const uncaught = [];
  process.on("uncaughtException", error => {
    uncaught.push(`${error?.code ?? error?.name}: ${error?.message}`);
  });
  const names = Object.keys(scenarios);
  const rows = await Promise.all(names.map(name => scenarios[name](process.argv[2] ?? os.tmpdir())));
  // A late exception belongs to the scenarios too.
  await new Promise(resolve => setImmediate(resolve));
  console.log(JSON.stringify({ rows: Object.fromEntries(names.map((name, i) => [name, rows[i]])), uncaught }, null, 1));
}
